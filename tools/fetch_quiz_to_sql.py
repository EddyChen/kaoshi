#!/usr/bin/env python3
import json
import sys
import time
from typing import Dict, Any, List

import urllib.request


def http_get_json(url: str) -> Dict[str, Any]:
	with urllib.request.urlopen(url) as resp:
		data = resp.read()
		text = data.decode('utf-8', errors='replace')
		return json.loads(text)


def normalize_question(q: Dict[str, Any]) -> Dict[str, Any]:
	# Determine type: assuming all are single_choice from API structure
	# If future APIs include multi-select, adapt accordingly
	options = {}
	for key in ['option_a', 'option_b', 'option_c', 'option_d']:
		if key in q and q[key] is not None and str(q[key]).strip() != '':
			label = key.split('_')[-1].upper()
			options[label] = str(q[key]).strip()

	answer = str(q.get('correct_option', '')).strip().upper()
	q_text = str(q.get('question_text', '')).strip()

	# Detect multiple choice if answer looks like multiple letters combined, e.g., 'AB' or 'ACD'
	q_type = 'single_choice'
	if len(answer) > 1 and all(ch in 'ABCD' for ch in answer):
		q_type = 'multiple_choice'

	return {
		'type': q_type,
		'question': q_text,
		'options': options if options else None,
		'answer': answer,
	}


def sql_escape(value: str) -> str:
	return value.replace("'", "''")


def to_insert_sql(item: Dict[str, Any], category_big: str, category_small: str) -> str:
	question = sql_escape(item['question'])
	answer = sql_escape(item['answer'])
	if item['options'] is None:
		options_sql = 'NULL'
	else:
		options_sql = "'" + sql_escape(json.dumps(item['options'], ensure_ascii=False)) + "'"
	return (
		"INSERT INTO questions (type, question, options, answer, category_big, category_small) "
		f"VALUES ('{item['type']}', '{question}', {options_sql}, '{answer}', '{sql_escape(category_big)}', '{sql_escape(category_small)}');"
	)


def main():
	if len(sys.argv) < 4:
		print('Usage: fetch_quiz_to_sql.py <start_id> <end_id> <output_sql_path>')
		sys.exit(1)

	start_id = int(sys.argv[1])
	end_id = int(sys.argv[2])
	output = sys.argv[3]

	api_tpl = 'https://zglg.work/api/quiz/{id}'
	all_inserts: List[str] = []

	for quiz_id in range(start_id, end_id + 1):
		url = api_tpl.format(id=quiz_id)
		try:
			payload = http_get_json(url)
			quiz_title = str(payload.get('title', ''))
			questions = payload.get('questionsWithChosen', [])
			for q in questions:
				norm = normalize_question(q)
				insert_sql = to_insert_sql(norm, '科技', '人工智能')
				all_inserts.append(insert_sql)
			# be gentle
			time.sleep(0.2)
		except Exception as e:
			all_inserts.append(f"-- quiz {quiz_id} fetch failed: {e}")

	with open(output, 'w', encoding='utf-8') as f:
		f.write('-- Generated from zglg.work API\n')
		for line in all_inserts:
			f.write(line + '\n')

	print(f'Wrote {len(all_inserts)} SQL statements to {output}')


if __name__ == '__main__':
	main()


