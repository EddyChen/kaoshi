-- 题目表
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('judgment', 'single_choice', 'multiple_choice')),
    question TEXT NOT NULL,
    options TEXT, -- JSON格式存储选项，判断题为NULL
	answer TEXT NOT NULL,
	category_big TEXT,
	category_small TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
);

-- 考试会话表
CREATE TABLE IF NOT EXISTS exam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('study', 'exam')), -- study: 背题模式, exam: 考试模式
    total_questions INTEGER NOT NULL DEFAULT 50,
    current_question INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    score INTEGER DEFAULT NULL, -- 最终得分
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 考试题目表（存储每次考试的具体题目）
CREATE TABLE IF NOT EXISTS exam_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    question_order INTEGER NOT NULL, -- 题目在考试中的顺序
    FOREIGN KEY (session_id) REFERENCES exam_sessions(id),
    FOREIGN KEY (question_id) REFERENCES questions(id),
    UNIQUE(session_id, question_order)
);

-- 用户答题记录表
CREATE TABLE IF NOT EXISTS user_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES exam_sessions(id),
    FOREIGN KEY (question_id) REFERENCES questions(id),
    UNIQUE(session_id, question_id)
);

-- 考试结果表
CREATE TABLE IF NOT EXISTS exam_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    score INTEGER NOT NULL,
    judgment_correct INTEGER DEFAULT 0,
    judgment_total INTEGER DEFAULT 0,
    single_choice_correct INTEGER DEFAULT 0,
    single_choice_total INTEGER DEFAULT 0,
    multiple_choice_correct INTEGER DEFAULT 0,
    multiple_choice_total INTEGER DEFAULT 0,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_id ON exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status ON exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_user_answers_session_id ON user_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_user_id ON exam_results(user_id); 