BEGIN TRANSACTION;
DELETE FROM user_answers WHERE question_id IN (
  SELECT id FROM questions WHERE category_big='科技' AND category_small='基础编程'
);
DELETE FROM exam_questions WHERE question_id IN (
  SELECT id FROM questions WHERE category_big='科技' AND category_small='基础编程'
);
DELETE FROM user_question_stats WHERE question_id IN (
  SELECT id FROM questions WHERE category_big='科技' AND category_small='基础编程'
);
DELETE FROM questions WHERE category_big='科技' AND category_small='基础编程';
COMMIT;
