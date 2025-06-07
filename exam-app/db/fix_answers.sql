-- 修复错误的答案

-- 修复第103题的答案（应该是A，因为答案是5）
UPDATE questions SET answer = 'A' WHERE id = 103;

-- 检查并修复其他可能错误的答案
-- 先查看当前这些题目的答案
SELECT id, question, answer FROM questions WHERE id IN (93, 103, 106, 124, 136, 145, 153, 157, 165, 175); 