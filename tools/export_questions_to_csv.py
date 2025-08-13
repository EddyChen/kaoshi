#!/usr/bin/env python3
import csv
import json
import subprocess
import sys
from typing import List, Dict, Any


def run_wrangler_query(command: List[str]) -> Dict[str, Any]:
    proc = subprocess.run(command, capture_output=True, text=True)
    out = proc.stdout
    # Find the JSON array boundaries in stdout
    start = out.find('[')
    end = out.rfind(']')
    if start == -1 or end == -1 or end <= start:
        raise RuntimeError('Unexpected wrangler output: cannot locate JSON array')
    json_text = out[start:end+1]
    return json.loads(json_text)[0]


def main():
    if len(sys.argv) < 3:
        print('Usage: export_questions_to_csv.py <wrangler_config_dir> <output_csv_path>')
        sys.exit(1)

    wrangler_dir = sys.argv[1]
    output_csv = sys.argv[2]

    sql = (
        'SELECT id, type, question, options, answer, category_big, category_small '
        'FROM questions WHERE category_big = "科技" ORDER BY id'
    )

    cmd = [
        'npx', '-y', 'wrangler', 'd1', 'execute', 'exam-database',
        '--command=' + sql,
        '--config=wrangler.jsonc'
    ]

    result = run_wrangler_query(cmd)
    rows: List[Dict[str, Any]] = result.get('results', [])

    # Write CSV
    fieldnames = ['id', 'type', 'question', 'options', 'answer', 'category_big', 'category_small']
    with open(output_csv, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            # ensure options serialized
            opts = r.get('options')
            if isinstance(opts, dict):
                r['options'] = json.dumps(opts, ensure_ascii=False)
            writer.writerow({k: r.get(k, '') for k in fieldnames})

    print(f'Exported {len(rows)} rows to {output_csv}')


if __name__ == '__main__':
    main()


