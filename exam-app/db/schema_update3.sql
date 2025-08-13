-- 为题目表增加分类字段，并设置现有题目的默认分类

-- 1) 增加字段（SQLite 支持直接 ADD COLUMN）
ALTER TABLE questions ADD COLUMN category_big TEXT;
ALTER TABLE questions ADD COLUMN category_small TEXT;

-- 2) 为历史数据设置默认分类
UPDATE questions
SET category_big = '信贷',
	category_small = 'A类'
WHERE category_big IS NULL OR category_small IS NULL;

-- 可选：为分类创建索引（如后续需要按分类筛选时可提升性能）
-- CREATE INDEX IF NOT EXISTS idx_questions_category_big ON questions(category_big);
-- CREATE INDEX IF NOT EXISTS idx_questions_category_small ON questions(category_small);


