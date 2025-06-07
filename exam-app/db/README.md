# 数据库脚本说明

## 核心脚本

### `schema.sql`
- 数据库表结构定义文件
- 包含所有表的创建语句：users, questions, question_types, exam_sessions, exam_answers, exam_results, user_question_stats

### `insert-questions.sql`
- 题库数据导入脚本
- 包含224道题目的INSERT语句

## 更新脚本

### `schema_update.sql`
- 添加user_question_stats表的schema更新

### `schema_update2.sql`
- 添加错题复习功能相关的更新

### `update_mode_constraint.sql`
- 更新exam_sessions表的mode字段约束

### `update_mode_constraint_safe.sql`
- 安全更新mode约束的脚本（修复表结构）

## 数据修复脚本

### `fix_questions.sql`
- 修复A选项与题干混合的问题（12道题目）

### `fix_more_questions.sql`
- 修复更多A选项混合问题（补充修复）

### `fix_answers.sql`
- 修复答案错误的脚本

### `fix_cd_options.sql`
- 修复C和D选项混合的问题（第190题）

## 使用说明

1. **初始化数据库**：
   ```bash
   # 创建表结构
   npx wrangler d1 execute exam-database --file=db/schema.sql
   
   # 导入题库数据
   npx wrangler d1 execute exam-database --file=db/insert-questions.sql
   ```

2. **更新数据库**：
   按照文件的时间顺序执行更新脚本

3. **修复数据**：
   根据需要执行相应的修复脚本
