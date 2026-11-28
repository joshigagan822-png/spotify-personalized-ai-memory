-- One row per registered workspace with retained pre-vote ranking observations.
-- Only the evaluation samples are returned; emails and search terms are excluded.
SELECT json_extract(w.document, '$.samples') AS samples
FROM accounts AS a
JOIN workspaces AS w ON w.id = 'account/' || a.subject AND w.subject_id = a.subject
WHERE json_extract(w.document, '$.version') = 2
  AND json_type(w.document, '$.samples') = 'array'
  AND json_array_length(w.document, '$.samples') > 0;
