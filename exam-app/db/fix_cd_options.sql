-- 修复第190题的C选项和D选项混合问题

-- 查看原始题目
SELECT id, question, options, answer FROM questions WHERE id = 190;

-- 修复第190题：正确分离C选项和D选项
UPDATE questions 
SET 
    options = '{"A":"定量评价反映客户偿债能力、流动性等财务经营状况及交易结算等账户信息","B":"定性评价反映客户的市场竞争地位、管理水平等非财务经营状况","C":"评价调整中的级别调整与限定反映财务报表审计结论、环保评价、违法违规等特殊事项对客户信用等级的影响","D":"评价调整中的外部支持反映由母公司或所在国(地区)政府对客户的支持意愿和能力"}'
WHERE id = 190;

-- 验证修复结果
SELECT id, question, options, answer FROM questions WHERE id = 190; 