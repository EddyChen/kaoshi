#!/usr/bin/env python3
"""
题库解析脚本
从HTML文件中提取题目信息，并转换为结构化数据
"""

import re
import json
from bs4 import BeautifulSoup
from typing import List, Dict, Any

def clean_text(text: str) -> str:
    """清理文本，移除多余的空白字符"""
    return re.sub(r'\s+', ' ', text.strip())

def extract_answer_from_text(text: str) -> tuple:
    """从文本中提取答案，返回(清理后的题目, 答案)"""
    # 匹配题目中包含答案的情况
    answer_pattern = r'(.+?)答案[:：]\s*([对错A-D]+)'
    match = re.search(answer_pattern, text)
    if match:
        question = match.group(1).strip()
        answer = match.group(2).strip()
        return question, answer
    return text, None

def parse_questions_html(file_path: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    解析HTML题库文件
    
    Args:
        file_path: HTML文件路径
        
    Returns:
        包含不同题型题目的字典
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 使用BeautifulSoup解析HTML
    soup = BeautifulSoup(content, 'html.parser')
    
    # 提取主要内容区域
    main_content = soup.find('div', class_='type_content_des')
    if not main_content:
        print("未找到主要内容区域")
        return {}
    
    # 获取所有段落
    paragraphs = main_content.find_all('p')
    
    questions = {
        'judgment': [],  # 判断题
        'single_choice': [],  # 单选题
        'multiple_choice': []  # 多选题
    }
    
    current_section = None
    current_question = None
    question_counter = 0
    
    for p in paragraphs:
        text = clean_text(p.get_text())
        if not text:
            continue
            
        # 检测题型分类
        if '一、判断题' in text:
            current_section = 'judgment'
            continue
        elif '二、单选题' in text:
            current_section = 'single_choice'
            continue
        elif '三、多选题' in text:
            current_section = 'multiple_choice'
            continue
            
        if current_section is None:
            continue
            
        # 解析题目
        if current_section == 'judgment':
            # 判断题格式：数字. 题目内容
            judgment_match = re.match(r'^(\d+)\.(.+)', text)
            if judgment_match:
                question_text = judgment_match.group(2).strip()
                # 检查题目中是否包含答案
                clean_question, embedded_answer = extract_answer_from_text(question_text)
                
                question_counter += 1
                current_question = {
                    'id': question_counter,
                    'type': 'judgment',
                    'question': clean_question,
                    'answer': embedded_answer
                }
                questions['judgment'].append(current_question)
            # 答案格式：答案: 对/错
            elif (text.startswith('答案:') or text.startswith('答案：')) and current_question and current_question['type'] == 'judgment':
                if current_question['answer'] is None:  # 只有当答案还没有设置时才设置
                    answer_text = text.split(':', 1)[-1].split('：', 1)[-1].strip()
                    current_question['answer'] = '对' if '对' in answer_text else '错'
                    
        elif current_section in ['single_choice', 'multiple_choice']:
            # 单选题/多选题格式：数字. 题目内容
            choice_match = re.match(r'^(\d+)\.(.+)', text)
            if choice_match:
                question_text = choice_match.group(2).strip()
                
                # 检查题目中是否包含答案
                clean_question, embedded_answer = extract_answer_from_text(question_text)
                
                # 检查题目末尾是否包含A选项（A.选项内容格式）
                a_option_match = re.search(r'(.+?)\s*A\.(.+)$', clean_question)
                if a_option_match:
                    # 分离题目和A选项
                    pure_question = a_option_match.group(1).strip()
                    a_option_content = a_option_match.group(2).strip()
                    
                    question_counter += 1
                    current_question = {
                        'id': question_counter,
                        'type': current_section,
                        'question': pure_question,
                        'options': {'A': a_option_content},
                        'answer': embedded_answer
                    }
                else:
                    question_counter += 1
                    current_question = {
                        'id': question_counter,
                        'type': current_section,
                        'question': clean_question,
                        'options': {},
                        'answer': embedded_answer
                    }
                
                questions[current_section].append(current_question)
                
            # 选项格式：A. 选项内容（但跳过已经在题目中解析过的A选项）
            elif re.match(r'^[A-D]\.', text) and current_question and current_question['type'] in ['single_choice', 'multiple_choice']:
                option_letter = text[0]
                option_content = text[2:].strip()
                
                # 如果是A选项且已经在题目解析时添加过，则跳过
                if option_letter == 'A' and 'A' in current_question['options']:
                    continue
                    
                current_question['options'][option_letter] = option_content
                
            # 答案格式：答案: A
            elif (text.startswith('答案:') or text.startswith('答案：')) and current_question and current_question['type'] in ['single_choice', 'multiple_choice']:
                if current_question['answer'] is None:  # 只有当答案还没有设置时才设置
                    answer_text = text.split(':', 1)[-1].split('：', 1)[-1].strip()
                    current_question['answer'] = answer_text
    
    # 清理无效题目（没有答案的题目）
    for question_type in questions:
        questions[question_type] = [q for q in questions[question_type] if q['answer'] is not None]
    
    return questions

def save_questions_to_json(questions: Dict[str, List[Dict[str, Any]]], output_file: str):
    """
    将题目数据保存为JSON文件
    
    Args:
        questions: 题目数据
        output_file: 输出文件路径
    """
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

def print_statistics(questions: Dict[str, List[Dict[str, Any]]]):
    """
    打印题目统计信息
    
    Args:
        questions: 题目数据
    """
    print("题库统计信息:")
    print(f"判断题: {len(questions['judgment'])} 道")
    print(f"单选题: {len(questions['single_choice'])} 道")
    print(f"多选题: {len(questions['multiple_choice'])} 道")
    print(f"总计: {sum(len(q) for q in questions.values())} 道")
    
    # 显示示例题目
    if questions['judgment']:
        print("\n判断题示例:")
        example = questions['judgment'][0]
        print(f"题目: {example['question']}")
        print(f"答案: {example['answer']}")
    
    if questions['single_choice']:
        print("\n单选题示例:")
        example = questions['single_choice'][0]
        print(f"题目: {example['question']}")
        for option, content in example['options'].items():
            print(f"{option}. {content}")
        print(f"答案: {example['answer']}")

if __name__ == "__main__":
    # 解析题库文件
    questions = parse_questions_html('questions.htm')
    
    # 打印统计信息
    print_statistics(questions)
    
    # 保存为JSON文件
    save_questions_to_json(questions, 'questions.json')
    print("\n题目数据已保存到 questions.json") 