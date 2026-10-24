import { writeFile } from "node:fs/promises";
import { interviewMarkdown } from "../src/interview-guide.js";
await writeFile(
  new URL("../docs/面试演示与答辩手册.md", import.meta.url),
  interviewMarkdown(),
);
console.log("Created docs/面试演示与答辩手册.md");
