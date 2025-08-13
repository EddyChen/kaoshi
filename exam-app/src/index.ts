/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	DB: D1Database;
}

// 路由处理器
class Router {
	private routes: Map<string, (request: Request, env: Env) => Promise<Response>> = new Map();

	add(method: string, path: string, handler: (request: Request, env: Env) => Promise<Response>) {
		this.routes.set(`${method}|${path}`, handler);
	}

	async handle(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const key = `${request.method}|${url.pathname}`;
		
		const handler = this.routes.get(key);
		if (handler) {
			return handler(request, env);
		}

		// 尝试匹配动态路由
		for (const [routeKey, handler] of this.routes.entries()) {
			const [method, path] = routeKey.split('|', 2);
			if (method === request.method && this.matchPath(path, url.pathname)) {
				return handler(request, env);
			}
		}

		return new Response('Not Found', { status: 404 });
	}

	private matchPath(pattern: string, path: string): boolean {
		const patternParts = pattern.split('/');
		const pathParts = path.split('/');

		if (patternParts.length !== pathParts.length) {
			return false;
		}

		for (let i = 0; i < patternParts.length; i++) {
			if (patternParts[i].startsWith(':')) {
				continue; // 动态参数，跳过
			}
			if (patternParts[i] !== pathParts[i]) {
				return false;
			}
		}

		return true;
	}
}

// 创建路由器
const router = new Router();

// 静态文件服务
router.add('GET', '/', async (request: Request, env: Env) => {
	return new Response(getIndexHTML(), {
		headers: {
			'Content-Type': 'text/html',
			// 放宽 CSP 以避免浏览器阻止 inline 脚本或 eval（开发/内嵌脚本场景）
			'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
		}
	});
});

// API路由
router.add('POST', '/api/login', async (request: Request, env: Env) => {
	try {
		const body = await request.json() as { phone?: string };
		const { phone } = body;
		
		if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
			return new Response(JSON.stringify({ error: '请输入有效的手机号' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 白名单校验
		const whitelisted = await env.DB.prepare('SELECT 1 FROM whitelist_users WHERE phone = ?').bind(phone).first();
		if (!whitelisted) {
			return new Response(JSON.stringify({ error: '该手机号未在白名单中，禁止登录' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 查找或创建用户
		let user = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
		
		if (!user) {
			const result = await env.DB.prepare('INSERT INTO users (phone) VALUES (?) RETURNING *')
				.bind(phone).first();
			user = result;
		} else {
			// 更新最后登录时间
			await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
				.bind((user as any).id).run();
		}

		return new Response(JSON.stringify({ 
			success: true, 
			user: { id: (user as any).id, phone: (user as any).phone }
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: '登录失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 开始考试
router.add('POST', '/api/exam/start', async (request: Request, env: Env) => {
	try {
		const body = await request.json() as { userId?: number; mode?: string; categoryBig?: string; categorySmall?: string; total?: number };
		const { userId, mode, categoryBig, categorySmall, total } = body;
		
		if (!userId || !mode || !['study', 'exam'].includes(mode)) {
			return new Response(JSON.stringify({ error: '参数错误' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 检查是否有未完成的考试
		const activeSession = await env.DB.prepare(
			'SELECT * FROM exam_sessions WHERE user_id = ? AND status = "active"'
		).bind(userId).first();

		// 若用户显式选择了分类或数量，则不复用旧会话；否则如果存在活动会话则直接复用
		const hasFilters = !!(categoryBig || categorySmall || (typeof total === 'number' && total > 0));
		if (activeSession && !hasFilters && (activeSession as any).mode === mode) {
			return new Response(JSON.stringify({ 
				success: true, 
				sessionId: (activeSession as any).id,
				message: '继续之前的考试'
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		// 存在旧会话且本次指定了筛选或数量，则将旧会话标记为放弃
		if (activeSession && hasFilters) {
			await env.DB.prepare('UPDATE exam_sessions SET status = "abandoned" WHERE id = ?')
				.bind((activeSession as any).id).run();
		}

		// 创建新的考试会话
		const session = await env.DB.prepare(
			'INSERT INTO exam_sessions (user_id, mode) VALUES (?, ?) RETURNING *'
		).bind(userId, mode).first();

		// 智能选择题目（支持分类与数量）
		const questions = await selectRandomQuestions(env.DB, userId, categoryBig, categorySmall, typeof total === 'number' ? total : undefined);
		
		// 保存考试题目
		for (let i = 0; i < questions.length; i++) {
			await env.DB.prepare(
				'INSERT INTO exam_questions (session_id, question_id, question_order) VALUES (?, ?, ?)'
			).bind((session as any).id, (questions[i] as any).id, i + 1).run();
		}

		return new Response(JSON.stringify({ 
			success: true, 
			sessionId: (session as any).id,
			totalQuestions: questions.length
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: '开始考试失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 获取题目
router.add('GET', '/api/exam/:sessionId/question/:order', async (request: Request, env: Env) => {
	try {
		const url = new URL(request.url);
		const pathParts = url.pathname.split('/');
		const sessionId = pathParts[3];
		const order = parseInt(pathParts[5]);

		const questionData = await env.DB.prepare(`
			SELECT q.*, eq.question_order 
			FROM questions q 
			JOIN exam_questions eq ON q.id = eq.question_id 
			WHERE eq.session_id = ? AND eq.question_order = ?
		`).bind(sessionId, order).first();

		if (!questionData) {
			return new Response(JSON.stringify({ error: '题目不存在' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 解析选项
		let options = null;
		if (questionData.options) {
			options = JSON.parse((questionData as any).options);
		}

		return new Response(JSON.stringify({
			success: true,
			question: {
				id: questionData.id,
				type: questionData.type,
				question: questionData.question,
				options: options,
				order: questionData.question_order
			}
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: '获取题目失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 提交答案
router.add('POST', '/api/exam/:sessionId/answer', async (request: Request, env: Env) => {
	try {
		const url = new URL(request.url);
		const sessionId = url.pathname.split('/')[3];
		const body = await request.json() as { questionId?: number; answer?: string };
		const { questionId, answer } = body;

		// 获取正确答案
		const question = await env.DB.prepare('SELECT * FROM questions WHERE id = ?')
			.bind(questionId).first();

		if (!question) {
			return new Response(JSON.stringify({ error: '题目不存在' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const isCorrect = answer === (question as any).answer;

		// 保存答案
		await env.DB.prepare(`
			INSERT OR REPLACE INTO user_answers 
			(session_id, question_id, user_answer, is_correct) 
			VALUES (?, ?, ?, ?)
		`).bind(sessionId, questionId, answer, isCorrect).run();

		// 获取会话信息（包括用户ID）
		const session = await env.DB.prepare('SELECT user_id, mode FROM exam_sessions WHERE id = ?')
			.bind(sessionId).first();

		// 更新用户答题统计
		if (session && questionId) {
			await updateUserQuestionStats(env.DB, (session as any).user_id, questionId, isCorrect);
		}

		const response: any = { success: true, isCorrect };
		
		// 如果是背题模式，返回正确答案
		if (session && (session as any).mode === 'study') {
			response.correctAnswer = (question as any).answer;
		}

		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: '提交答案失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 完成考试并获取成绩
router.add('POST', '/api/exam/:sessionId/finish', async (request: Request, env: Env) => {
	try {
		const url = new URL(request.url);
		const sessionId = url.pathname.split('/')[3];

		// 获取会话信息
		const session = await env.DB.prepare('SELECT user_id, mode FROM exam_sessions WHERE id = ?')
			.bind(sessionId).first();

		if (!session) {
			return new Response(JSON.stringify({ error: '考试会话不存在' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 更新考试状态为已完成
		await env.DB.prepare('UPDATE exam_sessions SET status = "completed", completed_at = CURRENT_TIMESTAMP WHERE id = ?')
			.bind(sessionId).run();

		// 计算成绩
		const stats = await env.DB.prepare(`
			SELECT 
				COUNT(*) as total_questions,
				SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers
			FROM user_answers 
			WHERE session_id = ?
		`).bind(sessionId).first();

		const totalQuestions = (stats as any)?.total_questions || 0;
		const correctAnswers = (stats as any)?.correct_answers || 0;
		const score = Math.round((correctAnswers / totalQuestions) * 100);

		// 更新exam_sessions表的score字段
		await env.DB.prepare('UPDATE exam_sessions SET score = ? WHERE id = ?')
			.bind(score, sessionId).run();

		// 保存考试结果
		await env.DB.prepare(`
			INSERT INTO exam_results (user_id, session_id, mode, total_questions, correct_answers, score)
			VALUES (?, ?, ?, ?, ?, ?)
		`).bind((session as any).user_id, sessionId, (session as any).mode, totalQuestions, correctAnswers, score).run();

		return new Response(JSON.stringify({
			success: true,
			result: {
				totalQuestions,
				correctAnswers,
				wrongAnswers: totalQuestions - correctAnswers,
				score
			}
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('完成考试失败:', error);
		return new Response(JSON.stringify({ error: '完成考试失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 获取用户错题列表
router.add('GET', '/api/user/:userId/wrong-questions', async (request: Request, env: Env) => {
	try {
		const url = new URL(request.url);
		const userId = url.pathname.split('/')[3];

		const wrongQuestions = await env.DB.prepare(`
			SELECT q.*, uqs.total_attempts, uqs.correct_attempts, uqs.last_attempt_at
			FROM questions q
			JOIN user_question_stats uqs ON q.id = uqs.question_id
			WHERE uqs.user_id = ? AND uqs.last_is_correct = 0
			ORDER BY uqs.last_attempt_at DESC
		`).bind(userId).all();

		// 解析选项
		const questions = wrongQuestions.results.map((q: any) => ({
			...q,
			options: q.options ? JSON.parse(q.options) : null
		}));

		return new Response(JSON.stringify({
			success: true,
			questions: questions,
			total: questions.length
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: '获取错题失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 开始错题复习会话
router.add('POST', '/api/user/:userId/review-wrong', async (request: Request, env: Env) => {
	try {
		const url = new URL(request.url);
		const userId = parseInt(url.pathname.split('/')[3]);

		// 获取用户的错题
		const wrongQuestions = await env.DB.prepare(`
			SELECT q.*
			FROM questions q
			JOIN user_question_stats uqs ON q.id = uqs.question_id
			WHERE uqs.user_id = ? AND uqs.last_is_correct = 0
			ORDER BY uqs.last_attempt_at DESC
		`).bind(userId).all();

		if (wrongQuestions.results.length === 0) {
			return new Response(JSON.stringify({ 
				success: false, 
				message: '您还没有错题需要复习' 
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 创建错题复习会话
		const session = await env.DB.prepare(
			'INSERT INTO exam_sessions (user_id, mode, total_questions) VALUES (?, ?, ?) RETURNING *'
		).bind(userId, 'review', wrongQuestions.results.length).first();

		// 保存错题到考试题目表
		for (let i = 0; i < wrongQuestions.results.length; i++) {
			await env.DB.prepare(
				'INSERT INTO exam_questions (session_id, question_id, question_order) VALUES (?, ?, ?)'
			).bind((session as any).id, (wrongQuestions.results[i] as any).id, i + 1).run();
		}

		return new Response(JSON.stringify({
			success: true,
			sessionId: (session as any).id,
			totalQuestions: wrongQuestions.results.length,
			message: '开始错题复习'
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('开始错题复习失败:', error);
		return new Response(JSON.stringify({ error: '开始错题复习失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});

// 智能选择题目（优先选择未答过/答错过/答题次数少的题目）
async function selectRandomQuestions(db: D1Database, userId?: number, categoryBig?: string, categorySmall?: string, overrideTotal?: number) {
	// 若用户指定题目数量，则忽略固定配比，按分类随机抽取指定数量
	if (overrideTotal && overrideTotal > 0) {
		const filters: string[] = [];
		const binds: any[] = [];
		if (categoryBig) {
			filters.push('category_big = ?');
			binds.push(categoryBig);
		}
		if (categorySmall) {
			filters.push('category_small = ?');
			binds.push(categorySmall);
		}
		const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
		const sql = `SELECT * FROM questions ${where} ORDER BY RANDOM() LIMIT ?`;
		const res = await db.prepare(sql).bind(...binds, overrideTotal).all();
		return res.results;
	}

	// 默认：按照原始要求：单选题20道，多选题10道，判断题20道，总共50道
	let judgmentQuestions, singleChoiceQuestions, multipleChoiceQuestions;
	
	if (userId) {
		// 智能选题：优先选择未答过、答错过、答题次数少的题目（支持分类过滤）
		judgmentQuestions = await selectIntelligentQuestions(db, userId, 'judgment', 20, categoryBig, categorySmall);
		singleChoiceQuestions = await selectIntelligentQuestions(db, userId, 'single_choice', 20, categoryBig, categorySmall);
		multipleChoiceQuestions = await selectIntelligentQuestions(db, userId, 'multiple_choice', 10, categoryBig, categorySmall);
	} else {
		// 完全随机选择
		judgmentQuestions = await db.prepare(
			`SELECT * FROM questions WHERE type = "judgment"${categoryBig ? ' AND category_big = ?' : ''}${categorySmall ? ' AND category_small = ?' : ''} ORDER BY RANDOM() LIMIT 20`
		).bind(...([categoryBig, categorySmall].filter(Boolean) as any)).all();
		
		singleChoiceQuestions = await db.prepare(
			`SELECT * FROM questions WHERE type = "single_choice"${categoryBig ? ' AND category_big = ?' : ''}${categorySmall ? ' AND category_small = ?' : ''} ORDER BY RANDOM() LIMIT 20`
		).bind(...([categoryBig, categorySmall].filter(Boolean) as any)).all();
		
		multipleChoiceQuestions = await db.prepare(
			`SELECT * FROM questions WHERE type = "multiple_choice"${categoryBig ? ' AND category_big = ?' : ''}${categorySmall ? ' AND category_small = ?' : ''} ORDER BY RANDOM() LIMIT 10`
		).bind(...([categoryBig, categorySmall].filter(Boolean) as any)).all();
		
		judgmentQuestions = judgmentQuestions.results;
		singleChoiceQuestions = singleChoiceQuestions.results;
		multipleChoiceQuestions = multipleChoiceQuestions.results;
	}

	// 确保没有重复题目
	const allQuestions = [
		...judgmentQuestions,
		...singleChoiceQuestions,
		...multipleChoiceQuestions
	];
	
	const uniqueQuestions = [];
	const seenIds = new Set();
	
	for (const question of allQuestions) {
		if (!seenIds.has(question.id)) {
			seenIds.add(question.id);
			uniqueQuestions.push(question);
		}
	}
	
	// 如果去重后题目不足50道，补充随机题目（按分类约束）
	if (uniqueQuestions.length < 50) {
		const neededCount = 50 - uniqueQuestions.length;
		const excludeIds = Array.from(seenIds);
		
		const additionalQuestions = await db.prepare(`
			SELECT * FROM questions 
			WHERE id NOT IN (${excludeIds.length ? excludeIds.map(() => '?').join(',') : 'NULL'})
			${categoryBig ? ' AND category_big = ?' : ''}
			${categorySmall ? ' AND category_small = ?' : ''}
			ORDER BY RANDOM() 
			LIMIT ?
		`).bind(...excludeIds, ...([categoryBig, categorySmall].filter(Boolean) as any), neededCount).all();
		
		uniqueQuestions.push(...additionalQuestions.results);
	}

	return uniqueQuestions;
}

// 智能选择特定类型的题目
async function selectIntelligentQuestions(db: D1Database, userId: number, type: string, limit: number, categoryBig?: string, categorySmall?: string) {
	// 优先级：1.未答过的题目 2.答错过的题目 3.答题次数少的题目（可按分类过滤）
	let whereClause = 'WHERE q.type = ?';
	const binds: any[] = [userId, type];
	if (categoryBig) {
		whereClause += ' AND q.category_big = ?';
		binds.push(categoryBig);
	}
	if (categorySmall) {
		whereClause += ' AND q.category_small = ?';
		binds.push(categorySmall);
	}
	binds.push(limit);

	const sql = `
		SELECT q.*, 
			COALESCE(uqs.total_attempts, 0) as attempts,
			COALESCE(uqs.correct_attempts, 0) as correct_attempts,
			COALESCE(uqs.last_is_correct, 1) as last_is_correct,
			CASE 
				WHEN uqs.id IS NULL THEN 1
				WHEN uqs.last_is_correct = 0 THEN 2
				ELSE 3 + uqs.total_attempts
			END as priority
		FROM questions q
		LEFT JOIN user_question_stats uqs ON q.id = uqs.question_id AND uqs.user_id = ?
		${whereClause}
		ORDER BY priority ASC, RANDOM()
		LIMIT ?
	`;

	const questions = await db.prepare(sql).bind(...binds).all();
	return questions.results;
}

// 更新用户答题统计
async function updateUserQuestionStats(db: D1Database, userId: number, questionId: number, isCorrect: boolean) {
	// 插入或更新用户答题统计
	await db.prepare(`
		INSERT INTO user_question_stats (user_id, question_id, total_attempts, correct_attempts, last_is_correct, last_attempt_at, updated_at)
		VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id, question_id) DO UPDATE SET
			total_attempts = total_attempts + 1,
			correct_attempts = correct_attempts + ?,
			last_is_correct = ?,
			last_attempt_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
	`).bind(userId, questionId, isCorrect ? 1 : 0, isCorrect, isCorrect ? 1 : 0, isCorrect).run();
}

// HTML页面
function getIndexHTML(): string {
	return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>在线考试系统</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 90%;
            max-width: 400px;
        }
        
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .logo h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .logo p {
            color: #666;
            font-size: 14px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
        }
        
        input[type="tel"] {
            width: 100%;
            padding: 15px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        input[type="tel"]:focus {
            outline: none;
            border-color: #667eea;
        }
		
		/* 新增：下拉与数字输入统一样式 */
		select,
		input[type="number"] {
			width: 100%;
			padding: 15px;
			border: 2px solid #e1e5e9;
			border-radius: 10px;
			font-size: 16px;
			transition: border-color 0.3s;
			appearance: none;
			background: white;
		}

		select:focus,
		input[type="number"]:focus {
			outline: none;
			border-color: #667eea;
		}

		/* 新增：筛选行布局 */
		.filters-row {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}

		.filter-item {
			flex: 1;
			min-width: 100px;
		}
        
        .mode-selection {
            margin: 20px 0;
        }
        
        .mode-buttons {
            display: flex;
            gap: 10px;
            flex-wrap: nowrap; /* 一行显示 */
        }
        
        .mode-btn {
            flex: 1;
            min-width: 100px;
            padding: 15px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            background: white;
            cursor: pointer;
            transition: all 0.3s;
            text-align: center;
        }
        
        .mode-btn.active {
            border-color: #667eea;
            background: #667eea;
            color: white;
        }
        
        .login-btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .login-btn:hover {
            transform: translateY(-2px);
        }
        
        .login-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .hidden {
            display: none;
        }
        
        .question-container {
            text-align: left;
        }
        
        .question-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e1e5e9;
        }
        
        .question-number {
            font-weight: bold;
            color: #667eea;
        }
        
        .question-type {
            background: #667eea;
            color: white;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
        }
        
        .question-text {
            font-size: 18px;
            line-height: 1.6;
            margin-bottom: 20px;
            color: #333;
        }
        
        .options {
            margin-bottom: 20px;
        }
        
        .option {
            display: block;
            width: 100%;
            padding: 15px;
            margin-bottom: 10px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            background: white;
            cursor: pointer;
            transition: all 0.3s;
            text-align: left;
        }
        
        .option:hover {
            border-color: #667eea;
        }
        
        .option.selected {
            border-color: #667eea;
            background: #f0f4ff;
        }
        
        .multiple-options {
            margin-bottom: 20px;
        }
        
        .option-label {
            display: block;
            padding: 15px;
            margin-bottom: 10px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            background: white;
            cursor: pointer;
            transition: all 0.3s;
            text-align: left;
        }
        
        .option-label:hover {
            border-color: #667eea;
        }
        
        .option-label input[type="checkbox"] {
            margin-right: 10px;
        }
        
        .option-label:has(input:checked) {
            border-color: #667eea;
            background: #f0f4ff;
        }
        
        .submit-multiple-btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
            margin-top: 10px;
        }
        
        .submit-multiple-btn:hover:not(:disabled) {
            transform: translateY(-2px);
        }
        
        .submit-multiple-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .judgment-buttons {
            display: flex;
            gap: 10px;
        }
        
        .judgment-btn {
            flex: 1;
            padding: 15px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            background: white;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .judgment-btn.selected {
            border-color: #667eea;
            background: #f0f4ff;
        }
        
        .answer-feedback {
            margin: 15px 0;
            padding: 15px;
            border-radius: 10px;
            font-weight: 500;
        }
        
        .answer-feedback.correct {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .answer-feedback.incorrect {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .action-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        .btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s;
        }
        
        .btn-primary {
            background: #667eea;
            color: white;
        }
        
        .btn-secondary {
            background: #6c757d;
            color: white;
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .result-container {
            text-align: center;
        }
        
        .result-score {
            font-size: 48px;
            font-weight: bold;
            color: #667eea;
            margin: 20px 0;
        }
        
        .result-details {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
        }
        
        .result-item {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
        }
        
        .multiple-options {
            margin-bottom: 20px;
        }
        
        .option-label {
            display: block;
            width: 100%;
            padding: 15px;
            margin-bottom: 10px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            background: white;
            cursor: pointer;
            transition: all 0.3s;
            text-align: left;
        }
        
        .option-label:hover {
            border-color: #667eea;
        }
        
        .option-label:has(.option-checkbox:checked) {
            border-color: #667eea;
            background: #f0f4ff;
        }
        
        .option-checkbox {
            margin-right: 10px;
            transform: scale(1.2);
        }
        
        .option-text {
            font-size: 16px;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 登录页面 -->
        <div id="loginPage">
            <div class="logo">
                <h1>📚 在线考试</h1>
                <p>请输入手机号登录</p>
            </div>
            
            <div class="form-group">
                <label for="phone">手机号</label>
                <input type="tel" id="phone" placeholder="请输入11位手机号" maxlength="11">
            </div>


			<div class="form-group">
				<div class="filters-row">
					<div class="filter-item">
						<label for="categoryBig">题目大类</label>
						<select id="categoryBig">
							<option value="">全部</option>
							<option value="信贷">信贷</option>
							<option value="科技类">科技类</option>
						</select>
					</div>
					<div class="filter-item">
						<label for="categorySmall">题目小类</label>
						<select id="categorySmall">
							<option value="">全部</option>
							<option value="A类">A类</option>
							<option value="人工智能">人工智能</option>
						</select>
					</div>
					<div class="filter-item">
						<label for="total">题目数量</label>
						<input type="number" id="total" placeholder="默认50" min="1" max="100" />
					</div>
				</div>
			</div>
            
            <div class="mode-selection">
                <label>选择模式</label>
                <div class="mode-buttons">
                    <button type="button" class="mode-btn active" data-mode="study">背题模式</button>
                    <button type="button" class="mode-btn" data-mode="exam">考试模式</button>
                    <button type="button" class="mode-btn" data-mode="review">错题复习</button>
                </div>
            </div>
            
            <button class="login-btn" onclick="login()">开始答题</button>
        </div>
        
        <!-- 答题页面 -->
        <div id="examPage" class="hidden">
            <div class="question-container">
                <div class="question-header">
                    <span class="question-number" id="questionNumber">第1题</span>
                    <span class="question-type" id="questionType">判断题</span>
                </div>
                
                <div class="question-text" id="questionText"></div>
                
                <div id="optionsContainer"></div>
                
                <div id="answerFeedback" class="answer-feedback hidden"></div>
                
                <div class="action-buttons">
                    <button class="btn btn-secondary" onclick="previousQuestion()" id="prevBtn">上一题</button>
                    <button class="btn btn-primary" onclick="nextQuestion()" id="nextBtn">下一题</button>
                </div>
            </div>
        </div>
        
        <!-- 结果页面 -->
        <div id="resultPage" class="hidden">
            <div class="result-container">
                <div class="logo">
                    <h1>🎉 考试完成</h1>
                </div>
                
                <div class="result-score" id="resultScore">0分</div>
                
                <div class="result-details">
                    <div class="result-item">
                        <span>总题数：</span>
                        <span id="totalQuestions">0</span>
                    </div>
                    <div class="result-item">
                        <span>正确题数：</span>
                        <span id="correctAnswers">0</span>
                    </div>
                    <div class="result-item">
                        <span>错误题数：</span>
                        <span id="wrongAnswers">0</span>
                    </div>
                </div>
                
                <button class="login-btn" onclick="restartExam()">重新开始</button>
            </div>
        </div>
    </div>

    <script>
        let currentUser = null;
        let currentSession = null;
        let currentMode = 'study';
        let currentQuestionOrder = 1;
        let currentQuestionId = null;
        let selectedAnswer = null;
        let totalQuestions = 50;
        
        // 模式选择
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMode = btn.dataset.mode;
            });
        });
        
        // 登录
        async function login() {
            const phone = document.getElementById('phone').value;
            
            if (!phone || !/^1[3-9]\\d{9}$/.test(phone)) {
                alert('请输入有效的手机号');
                return;
            }
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    currentUser = data.user;
                    await startExam();
                } else {
                    alert(data.error || '登录失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 开始考试
		async function startExam() {
            try {
                let response, data;
                
                if (currentMode === 'review') {
                    // 错题复习模式
                    response = await fetch(\`/api/user/\${currentUser.id}/review-wrong\`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
				} else {
					// 普通考试模式（纯JS，避免TS语法）
					const categoryBigEl = document.getElementById('categoryBig');
					const categorySmallEl = document.getElementById('categorySmall');
					const totalEl = document.getElementById('total');
					const categoryBig = categoryBigEl && categoryBigEl.value ? categoryBigEl.value : undefined;
					const categorySmall = categorySmallEl && categorySmallEl.value ? categorySmallEl.value : undefined;
					const totalStr = totalEl && totalEl.value ? totalEl.value : '';
					const total = totalStr ? parseInt(totalStr, 10) : undefined;
                    response = await fetch('/api/exam/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ userId: currentUser.id, mode: currentMode, categoryBig, categorySmall, total })
                    });
                }
                
                data = await response.json();
                
                if (data.success) {
                    currentSession = data.sessionId;
                    totalQuestions = data.totalQuestions || 50;
                    document.getElementById('loginPage').classList.add('hidden');
                    document.getElementById('examPage').classList.remove('hidden');
                    await loadQuestion(1);
                } else {
                    alert(data.message || data.error || '开始失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 加载题目
        async function loadQuestion(order) {
            try {
                const response = await fetch(\`/api/exam/\${currentSession}/question/\${order}\`);
                const data = await response.json();
                
                if (data.success) {
                    displayQuestion(data.question);
                    currentQuestionOrder = order;
                    currentQuestionId = data.question.id;
                    updateNavigationButtons();
                } else {
                    alert(data.error || '加载题目失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 显示题目
        function displayQuestion(question) {
            document.getElementById('questionNumber').textContent = \`第\${question.order}题\`;
            document.getElementById('questionType').textContent = getTypeText(question.type);
            document.getElementById('questionText').textContent = question.question;
            
            const container = document.getElementById('optionsContainer');
            container.innerHTML = '';
            selectedAnswer = null;
            
            if (question.type === 'judgment') {
                const buttonsHtml = \`
                    <div class="judgment-buttons">
                        <button class="judgment-btn" onclick="selectAnswer('对')">对</button>
                        <button class="judgment-btn" onclick="selectAnswer('错')">错</button>
                    </div>
                \`;
                container.innerHTML = buttonsHtml;
            } else if (question.type === 'multiple_choice') {
                // 多选题
                const optionsHtml = Object.entries(question.options).map(([key, value]) => 
                    \`<label class="option-label">
                        <input type="checkbox" class="option-checkbox" value="\${key}" onchange="selectMultipleAnswer()">
                        <span class="option-text">\${key}. \${value}</span>
                    </label>\`
                ).join('');
                const submitButtonHtml = \`<button class="submit-multiple-btn" onclick="submitMultipleAnswer()" disabled>确认答案</button>\`;
                container.innerHTML = \`<div class="multiple-options">\${optionsHtml}</div>\${submitButtonHtml}\`;
            } else {
                // 单选题
                const optionsHtml = Object.entries(question.options).map(([key, value]) => 
                    \`<button class="option" onclick="selectAnswer('\${key}')">\${key}. \${value}</button>\`
                ).join('');
                container.innerHTML = optionsHtml;
            }
            
            // 隐藏答案反馈
            document.getElementById('answerFeedback').classList.add('hidden');
        }
        
        // 选择答案（单选和判断题）
        function selectAnswer(answer) {
            selectedAnswer = answer;
            
            // 更新UI
            document.querySelectorAll('.option, .judgment-btn').forEach(btn => {
                btn.classList.remove('selected');
            });
            
            event.target.classList.add('selected');
            
            // 提交答案
            submitAnswer();
        }
        
        // 选择多选答案
        function selectMultipleAnswer() {
            const checkboxes = document.querySelectorAll('.option-checkbox:checked');
            const answers = Array.from(checkboxes).map(cb => cb.value).sort().join('');
            selectedAnswer = answers;
            
            // 启用或禁用确认按钮
            const submitBtn = document.querySelector('.submit-multiple-btn');
            if (submitBtn) {
                submitBtn.disabled = !selectedAnswer;
            }
        }
        
        // 提交多选答案
        function submitMultipleAnswer() {
            if (selectedAnswer) {
                submitAnswer();
            }
        }
        
        // 提交答案
        async function submitAnswer() {
            if (!selectedAnswer || !currentQuestionId) return;
            
            try {
                const response = await fetch(\`/api/exam/\${currentSession}/answer\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        questionId: currentQuestionId, 
                        answer: selectedAnswer 
                    })
                });
                
                const data = await response.json();
                
                if (data.success && currentMode === 'study') {
                    showAnswerFeedback(data.isCorrect, data.correctAnswer);
                }
            } catch (error) {
                console.error('提交答案失败:', error);
            }
        }
        
        // 显示答案反馈
        function showAnswerFeedback(isCorrect, correctAnswer) {
            const feedback = document.getElementById('answerFeedback');
            feedback.classList.remove('hidden', 'correct', 'incorrect');
            feedback.classList.add(isCorrect ? 'correct' : 'incorrect');
            
            if (isCorrect) {
                feedback.textContent = '✅ 回答正确！';
            } else {
                feedback.textContent = \`❌ 回答错误，正确答案是：\${correctAnswer}\`;
            }
        }
        
        // 上一题
        function previousQuestion() {
            if (currentQuestionOrder > 1) {
                loadQuestion(currentQuestionOrder - 1);
            }
        }
        
        // 下一题
        function nextQuestion() {
            if (currentQuestionOrder < totalQuestions) {
                loadQuestion(currentQuestionOrder + 1);
            } else {
                finishExam();
            }
        }
        
        // 更新导航按钮
        function updateNavigationButtons() {
            document.getElementById('prevBtn').disabled = currentQuestionOrder === 1;
            
            if (currentQuestionOrder === totalQuestions) {
                document.getElementById('nextBtn').textContent = '完成考试';
            } else {
                document.getElementById('nextBtn').textContent = '下一题';
            }
        }
        
        // 完成考试
        async function finishExam() {
            if (!confirm('确定要提交考试吗？')) {
                return;
            }
            
            try {
                const response = await fetch(\`/api/exam/\${currentSession}/finish\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showResult(data.result);
                } else {
                    alert(data.error || '提交考试失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 显示结果
        function showResult(result) {
            document.getElementById('examPage').classList.add('hidden');
            document.getElementById('resultPage').classList.remove('hidden');
            
            document.getElementById('resultScore').textContent = result.score + '分';
            document.getElementById('totalQuestions').textContent = result.totalQuestions;
            document.getElementById('correctAnswers').textContent = result.correctAnswers;
            document.getElementById('wrongAnswers').textContent = result.wrongAnswers;
        }
        
        // 重新开始
        function restartExam() {
            document.getElementById('resultPage').classList.add('hidden');
            document.getElementById('loginPage').classList.remove('hidden');
            
            // 重置状态
            currentUser = null;
            currentSession = null;
            currentQuestionOrder = 1;
            currentQuestionId = null;
            selectedAnswer = null;
            document.getElementById('phone').value = '';
        }
        
        // 获取题目类型文本
        function getTypeText(type) {
            const typeMap = {
                'judgment': '判断题',
                'single_choice': '单选题',
                'multiple_choice': '多选题'
            };
            const baseType = typeMap[type] || '未知题型';
            return currentMode === 'review' ? \`错题复习 - \${baseType}\` : baseType;
        }
    </script>
</body>
</html>
	`;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return router.handle(request, env);
	},
};
