import { createHighlighter } from "shiki";

async function run() {
  const highlighter = await createHighlighter({
    langs: ["javascript"],
    themes: ["github-light-default", "github-dark-default"],
  });
  console.log(highlighter.getLoadedThemes());
  const res = highlighter.codeToTokens("const a = 1;", {
    lang: "javascript",
    themes: { light: "github-light-default", dark: "github-dark-default" }
  });
  console.log("Success");
}
run().catch(console.error);
