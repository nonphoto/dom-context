import { compile, serialize, stringify } from "https://cdn.skypack.dev/stylis";
import hash from "https://cdn.skypack.dev/@emotion/hash";

const elements = document.querySelectorAll("style[scoped]");
for (let element of elements) {
  const css = element.textContent;
  const id = hash(css);
  element.parentElement.dataset.css = id;
  element.textContent = serialize(
    compile(`[data-css="${id}"]{${css}}`),
    stringify
  );
  element.removeAttribute("scoped");
}
