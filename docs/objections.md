# Objections visitors have raised

Copy answers an objection only when a visitor has actually raised it, and only where they asked it: in an FAQ, or beside the control it concerns, never in a page's opening paragraph or its meta description. Copy that answers a doubt nobody voiced ("you might be wondering", "don't worry", "not another …", "Not a toy. A …", "we don't X because …") plants the doubt it means to settle, so state what the thing does instead, answer first. A disclosure the reader needs — a limit that changes what a number or label means, or a statement that Stims is not affiliated with a project — stays, said once and plainly, after the answer.

`bun run check:readme-claims` scans what the site publishes for those phrasings (the pattern list is `PRESUPPOSING_COPY` in [`scripts/check-readme-claims.ts`](../scripts/check-readme-claims.ts)). A sentence that answers a row below passes when it carries the row's id: `<!-- objection: <id> -->` in markdown or HTML, `// objection: <id>` in TypeScript, on the same line or the line above. The check fails on a marker whose id has no row here.

| id | Objection, as a visitor put it | Evidence (where and when it was heard) | Where the copy answers it |
| --- | --- | --- | --- |

Add an objection only with its evidence: an issue, a message or a recorded conversation in which a visitor raised it. None has been recorded yet.
