#!/usr/bin/env python3
"""
Parse basic programming quiz HTML files (Nowcoder-like submission pages) under a directory
and generate SQL INSERT statements for the questions table.

Rules:
- Skip any question whose stem or options contain images (<img ...>).
- Preserve code/pre blocks and inline HTML for question and options (store as HTML strings).
- Ignore "官方解析" and "题友讨论" blocks.
- Ensure correct mapping of type, options, and answers.
- Set category_big = "科技", category_small = "基础编程".

Usage:
  venv/bin/python3 tools/parse_basic_programming_to_sql.py exam-app/data exam-app/db/insert-questions-tech-basic-programming.sql

Recommended before running:
  - Install dependencies: beautifulsoup4, lxml (optional but faster/robust)
    venv/bin/python3 -m pip install beautifulsoup4 lxml

After generation, import to D1 (dev example):
  wrangler d1 execute exam-database --file=exam-app/db/insert-questions-tech-basic-programming.sql
"""

import os
import re
import sys
import json
import copy
from typing import Dict, Any, List, Optional

from bs4 import BeautifulSoup, Tag


CATEGORY_BIG = "科技"
CATEGORY_SMALL = "基础编程"


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def to_insert_sql(item: Dict[str, Any]) -> str:
    question_html = sql_escape(item['question'])
    answer = sql_escape(item['answer'])
    if item['options'] is None:
        options_sql = 'NULL'
    else:
        options_sql = "'" + sql_escape(json.dumps(item['options'], ensure_ascii=False)) + "'"
    return (
        "INSERT INTO questions (type, question, options, answer, category_big, category_small) "
        f"VALUES ('{item['type']}', '{question_html}', {options_sql}, '{answer}', '{sql_escape(CATEGORY_BIG)}', '{sql_escape(CATEGORY_SMALL)}');"
    )


def has_img_html(html: str) -> bool:
    return '<img' in html.lower()


SAFE_TAGS = {
    # Intentionally exclude 'p' and 'br' (we'll convert them to newlines)
    'pre', 'code', 'strong', 'em', 'b', 'i',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
}


def flatten_code_blocks(soup: BeautifulSoup) -> None:
    # Convert Nowcoder syntaxhighlighter blocks into <pre><code>text</code></pre>
    for block in list(soup.select('div.syntaxhighlighter')):
        # Remove toolbar (often contains "复制代码")
        for tb in block.select('.toolbar'):
            tb.decompose()
        text = block.get_text('\n', strip=False)
        # drop lingering "复制代码" markers just in case
        text = text.replace('复制代码', '')
        pre = soup.new_tag('pre')
        code = soup.new_tag('code')
        code.string = text
        pre.append(code)
        block.replace_with(pre)


def sanitize_html_fragment(html: str) -> str:
    if not html:
        return ''
    # Use lxml if available for better parsing
    try:
        frag = BeautifulSoup(html, 'lxml')
    except Exception:
        frag = BeautifulSoup(html, 'html.parser')

    flatten_code_blocks(frag)

    # Replace <br> with newline text nodes
    for br in list(frag.find_all('br')):
        br.replace_with('\n')

    # For each <p>, append a newline after and unwrap to keep paragraph separation
    for p in list(frag.find_all('p')):
        p.insert_after('\n')
        p.unwrap()

    # Remove all attributes and non-safe tags while preserving their text/children
    for el in list(frag.find_all(True)):
        # Strip attributes
        el.attrs = {}
        if el.name not in SAFE_TAGS:
            el.unwrap()

    # Collapse excessive whitespace
    out = str(frag)
    # Remove any remaining '复制代码'
    out = out.replace('复制代码', '')
    # Normalize whitespace while preserving newlines
    out = re.sub(r'\r\n', '\n', out)
    out = re.sub(r'\n\s*\n\s*\n+', '\n\n', out)
    out = re.sub(r'[\t\x0b\x0c\r]+', ' ', out)
    out = re.sub(r' +', ' ', out)
    # Trim spaces around newlines
    out = re.sub(r' *\n *', '\n', out)
    return out.strip()


def normalize_question_type(type_text: str) -> Optional[str]:
    t = type_text.strip()
    if '单选题' in t:
        return 'single_choice'
    if '多选题' in t:
        return 'multiple_choice'
    if '判断题' in t:
        return 'judgment'
    return None


def extract_answer_text(answer_wrap: Tag) -> Optional[str]:
    # Prefer visible green span if exists
    # Fallback to regex over text
    if answer_wrap is None:
        return None
    text = answer_wrap.get_text(" ", strip=True)
    # Examples: "正确答案：C" or "正确答案：对" or multi like "正确答案：AB"
    m = re.search(r'正确答案[:：]\s*([A-D对错]+)', text)
    if m:
        return m.group(1).strip()
    # Sometimes letter may be inside a span
    green = answer_wrap.select_one('span.tw-text-green-500')
    if green and green.get_text(strip=True):
        return green.get_text(strip=True)
    return None


EXCLUDE_CLASS_SUBSTRINGS = [
    'question-select',
    'answer-wrap',
    'comment-wrap',
    'quick-publish',
    'result-wrap',
    'question-desc-header',
    'rightAction',
]


def remove_unwanted_blocks(root: Tag) -> None:
    # Remove blocks by class substrings
    for cls in EXCLUDE_CLASS_SUBSTRINGS:
        for el in root.select(f"div[class*='{cls}']"):
            el.decompose()
    # Remove obvious analysis/knowledge sections
    for el in list(root.find_all(['div', 'section', 'p', 'span'])):
        txt = el.get_text(" ", strip=True)
        if not txt:
            continue
        if txt.startswith('官方解析') or txt.startswith('知识点') or txt.startswith('题友讨论'):
            # Decompose the parent block to ensure full removal
            (el.parent or el).decompose()


def extract_stem_html(q_item: Tag) -> Optional[str]:
    # Work on a clone to avoid mutating the original tree
    q_clone = BeautifulSoup(str(q_item), 'lxml') if q_item and q_item.name else None
    if q_clone is None:
        return None
    remove_unwanted_blocks(q_clone)
    # Prefer the Nowcoder stem container
    stem_host = (
        q_clone.select_one('.commonPaperHtml')
        or q_clone.select_one('.question-desc')
        or q_clone
    )
    raw_html = stem_host.decode_contents().strip()
    return sanitize_html_fragment(raw_html)


def parse_question_item(q_item: Tag) -> Optional[Dict[str, Any]]:
    # Determine type
    type_label_el = q_item.select_one('.singleClass, .commonClass, .multipleClass, .judgmentClass')
    q_type = None
    if type_label_el is not None:
        q_type = normalize_question_type(type_label_el.get_text(strip=True))
    if q_type is None:
        return None

    # Options (if any)
    options_div = q_item.select_one("div[class*='question-select']")
    options: Optional[Dict[str, str]] = None
    if options_div is not None:
        options = {}
        for opt in options_div.select("div.option-item"):
            label_el = opt.select_one('.label')
            content_el = opt.select_one('.content')
            if not label_el or not content_el:
                continue
            label = label_el.get_text(strip=True).upper()
            # Preserve sanitized HTML content
            content_html = sanitize_html_fragment(content_el.decode_contents().strip())
            options[label] = content_html
        if not options:
            options = None

    # Answer
    answer_wrap = q_item.select_one("div[class*='answer-wrap']")
    answer_text = extract_answer_text(answer_wrap)
    if answer_text is None:
        return None
    # Normalize judgment answers
    if q_type == 'judgment':
        if answer_text in ('A', '对', '正确', 'True', 'TRUE'):
            answer_text = '对'
        elif answer_text in ('B', '错', '错误', 'False', 'FALSE'):
            answer_text = '错'
        else:
            # Unexpected, keep raw
            pass

    # Stem
    stem_html = extract_stem_html(q_item)
    if stem_html is None:
        return None

    # Skip if any image present in stem or options
    if has_img_html(stem_html):
        return None
    if options is not None:
        for v in options.values():
            if has_img_html(v):
                return None

    # For single_choice/multiple_choice, ensure options exist
    if q_type in ('single_choice', 'multiple_choice') and not options:
        return None

    # Multiple-choice answers: normalize to concatenated letters without separators
    if q_type == 'multiple_choice':
        answer_text = ''.join(ch for ch in answer_text if ch.upper() in 'ABCD').upper()

    return {
        'type': q_type,
        'question': stem_html,
        'options': options,
        'answer': answer_text,
    }


def parse_file(path: str) -> List[Dict[str, Any]]:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        html = f.read()
    # Prefer lxml if available
    parser = 'lxml'
    try:
        soup = BeautifulSoup(html, parser)
    except Exception:
        soup = BeautifulSoup(html, 'html.parser')

    results: List[Dict[str, Any]] = []
    for q_item in soup.select('div.question-item'):
        try:
            parsed = parse_question_item(q_item)
            if parsed is not None:
                results.append(parsed)
        except Exception:
            # Skip malformed blocks
            continue
    return results


def main():
    if len(sys.argv) < 3:
        print('Usage: parse_basic_programming_to_sql.py <input_dir> <output_sql_path>')
        sys.exit(1)

    input_dir = sys.argv[1]
    output_sql = sys.argv[2]

    all_questions: List[Dict[str, Any]] = []
    for name in sorted(os.listdir(input_dir)):
        if not name.lower().endswith('.html'):
            continue
        path = os.path.join(input_dir, name)
        file_questions = parse_file(path)
        all_questions.extend(file_questions)

    inserts: List[str] = [
        "-- Generated by tools/parse_basic_programming_to_sql.py",
        f"-- Category: {CATEGORY_BIG}/{CATEGORY_SMALL}",
        f"-- Source: {input_dir}",
    ]
    for q in all_questions:
        inserts.append(to_insert_sql(q))

    os.makedirs(os.path.dirname(output_sql), exist_ok=True)
    with open(output_sql, 'w', encoding='utf-8') as f:
        for line in inserts:
            f.write(line + '\n')

    # Print brief stats and few samples
    type_counts: Dict[str, int] = {}
    for q in all_questions:
        type_counts[q['type']] = type_counts.get(q['type'], 0) + 1
    print(f"Parsed questions: {len(all_questions)}")
    print("By type:", type_counts)
    for i, q in enumerate(all_questions[:3]):
        print(f"\nSample {i+1}:")
        print(f"Type: {q['type']}")
        print(f"Answer: {q['answer']}")
        if q['options']:
            print("Options:", ", ".join(sorted(q['options'].keys())))
        print("Stem (truncated):", re.sub(r'\s+', ' ', q['question'])[:120] + ('...' if len(q['question']) > 120 else ''))
    print(f"\nWrote {len(inserts)-3} SQL statements to {output_sql}")


if __name__ == '__main__':
    main()


