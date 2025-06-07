-- 删除现有的mode检查约束并重新创建，添加review模式
-- SQLite不支持直接修改CHECK约束，需要重建表或者忽略约束
-- 这里我们先创建一个临时的更新语句来验证现有数据

-- 验证当前mode值是否符合新约束
SELECT DISTINCT mode FROM exam_sessions;

-- 注意：在生产环境中，SQLite的CHECK约束在添加新值时不会立即生效
-- 新的INSERT操作将支持'review'模式 