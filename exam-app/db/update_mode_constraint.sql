-- 更新exam_sessions表以支持review模式
-- SQLite需要重建表来修改CHECK约束

-- 1. 创建新表结构
CREATE TABLE exam_sessions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('study', 'exam', 'review')), -- 添加review模式
    total_questions INTEGER NOT NULL DEFAULT 50,
    current_question INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    score INTEGER DEFAULT NULL, -- 最终得分
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 2. 复制现有数据
INSERT INTO exam_sessions_new 
SELECT * FROM exam_sessions;

-- 3. 删除旧表
DROP TABLE exam_sessions;

-- 4. 重命名新表
ALTER TABLE exam_sessions_new RENAME TO exam_sessions;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_id ON exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status ON exam_sessions(status); 