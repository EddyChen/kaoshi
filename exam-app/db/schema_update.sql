-- 用户答题历史统计表
CREATE TABLE IF NOT EXISTS user_question_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    total_attempts INTEGER DEFAULT 0,    -- 总答题次数
    correct_attempts INTEGER DEFAULT 0,  -- 正确次数
    last_attempt_at DATETIME DEFAULT NULL, -- 最后答题时间
    last_is_correct BOOLEAN DEFAULT NULL,  -- 最后一次是否正确
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (question_id) REFERENCES questions(id),
    UNIQUE(user_id, question_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_question_stats_user_id ON user_question_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_question_stats_question_id ON user_question_stats(question_id);
CREATE INDEX IF NOT EXISTS idx_user_question_stats_last_is_correct ON user_question_stats(last_is_correct); 