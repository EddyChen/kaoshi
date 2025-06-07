#!/usr/bin/env node
/**
 * 题库数据导入脚本
 * 将JSON格式的题库数据导入到D1数据库
 */

const fs = require('fs');
const path = require('path');

// 读取题库JSON文件
const questionsData = JSON.parse(fs.readFileSync('questions.json', 'utf8'));

// SQL字符串转义函数
function escapeSQLString(str) {
    return str.replace(/'/g, "''");
}

// 生成SQL插入语句
function generateInsertSQL() {
    const insertStatements = [];
    let questionId = 1;
    
    // 处理判断题
    for (const question of questionsData.judgment) {
        const sql = `INSERT INTO questions (id, type, question, options, answer) VALUES (${questionId}, 'judgment', '${escapeSQLString(question.question)}', NULL, '${escapeSQLString(question.answer)}');`;
        insertStatements.push(sql);
        questionId++;
    }
    
    // 处理单选题
    for (const question of questionsData.single_choice) {
        const options = escapeSQLString(JSON.stringify(question.options));
        const sql = `INSERT INTO questions (id, type, question, options, answer) VALUES (${questionId}, 'single_choice', '${escapeSQLString(question.question)}', '${options}', '${escapeSQLString(question.answer)}');`;
        insertStatements.push(sql);
        questionId++;
    }
    
    // 处理多选题
    for (const question of questionsData.multiple_choice) {
        const options = escapeSQLString(JSON.stringify(question.options));
        const sql = `INSERT INTO questions (id, type, question, options, answer) VALUES (${questionId}, 'multiple_choice', '${escapeSQLString(question.question)}', '${options}', '${escapeSQLString(question.answer)}');`;
        insertStatements.push(sql);
        questionId++;
    }
    
    return insertStatements;
}

// 生成SQL文件
const sqlStatements = generateInsertSQL();
const sqlContent = sqlStatements.join('\n');

// 写入SQL文件
fs.writeFileSync('insert-questions.sql', sqlContent);

console.log(`生成了 ${sqlStatements.length} 条插入语句`);
console.log('SQL文件已保存为: insert-questions.sql');
console.log('请运行以下命令导入数据:');
console.log('wrangler d1 execute exam-database --file=insert-questions.sql'); 