-- 修复题库中A选项与题干混合的问题

-- 修复第94题：贷款资金用途违规题目
UPDATE questions 
SET 
    question = '贷款资金用途违规在系统加上标识后，将本笔贷款形态至少调整为( )，并将该借款人纳入个人客户不良信息库。',
    options = '{"A":"关注类","B":"不良类","C":"次级类","D":"不用操作"}'
WHERE question LIKE '%贷款资金用途违规在系统加上标识后，将本笔贷款形态至少调整为%A.关注类%';

-- 修复第104题：监控人员题目
UPDATE questions 
SET 
    question = '监控人员应及时查看当日进入信用卡风险实时监控系统的预警任务并确保在( )个工作日内妥善处理完毕。',
    options = '{"A":"5","B":"7","C":"3","D":"1"}'
WHERE question LIKE '%监控人员应及时查看当日进入信用卡风险实时监控系统的预警任务%A.5%';

-- 检查其他可能存在类似问题的题目
-- 查找题干中包含"A."的单选题和多选题
SELECT id, question, options, answer 
FROM questions 
WHERE type IN ('single_choice', 'multiple_choice') 
AND question LIKE '%A.%' 
AND question NOT LIKE '%答案%';

-- 修复其他可能的问题题目（如果发现的话）
-- 这里可以根据查询结果添加更多的UPDATE语句 