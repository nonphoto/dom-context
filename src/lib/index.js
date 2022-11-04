import Stream from "https://cdn.skypack.dev/s-js";
import * as moduleLexer from "https://cdn.skypack.dev/es-module-lexer";
import get from "https://cdn.skypack.dev/lodash-es/get";

Stream.create = (...args) => {
  const s = Stream.data(...args);
  return [() => s(), (v) => s(v)];
};

window.Stream = Stream;

function scalarParser(key, context) {
  const value = get(context, key);
  if (!value) {
    console.warn(`Value with key "${key}" not found in context`);
  }
  return value;
}

function vectorParser(s, context) {
  return s.split(/\s+/).map((key) => scalarParser(key, context));
}

function mapParser(s, context) {
  return new Map(
    s.split(";").map((assignment) => {
      const [key, value, ...rest] = assignment.split(":");
      if (!key || !value || rest.length > 0) {
        throw new Error(`Malformed attribute value ${assignment}`);
      } else {
        return [key.trim(), scalarParser(value.trim(), context)];
      }
    })
  );
}

const directives = [
  {
    parser: scalarParser,
    name: "bind-text",
    callback: textDirective,
  },
  {
    parser: mapParser,
    name: "bind-attr",
    callback: attributeDirective,
  },
  {
    parser: mapParser,
    name: "bind-style",
    callback: styleDirective,
  },
  {
    parser: mapParser,
    name: "bind-on",
    callback: onDirective,
  },
  {
    parser: vectorParser,
    name: "bind-ref",
    callback: refDirective,
  },
  {
    parser: vectorParser,
    name: "bind-multiref",
    callback: multirefDirective,
  },
];

const directiveNames = directives.map((directive) => directive.name);

function isComponent(element) {
  return (
    element.tagName === "SCRIPT" && element.getAttribute("context") !== null
  );
}

async function runInlineScript(script, parentProviderState) {
  await moduleLexer.init;
  const [imports] = moduleLexer.parse(script.textContent);
  let text = "";
  let t = 0;
  for (const { s, e } of imports) {
    text +=
      script.textContent.slice(t, s) +
      new URL(script.textContent.slice(s, e), window.location.href);
    t = e;
  }
  text += script.textContent.slice(t);
  text = parentProviderState
    ? `import * as context from "${parentProviderState.src}"; export * from "${parentProviderState.src}"; ${text}`
    : text;
  const src = URL.createObjectURL(
    new Blob([text], { type: "application/javascript" })
  );
  try {
    const module = await import(src);
    return Stream.root(async (disposer) => {
      try {
        const parentContext =
          (parentProviderState && parentProviderState.context) || {};
        const context = module.default(parentContext) || {};
        return {
          context: { ...parentContext, ...context },
          src,
          disposer,
        };
      } catch (error) {
        console.error(`Error in inline script: ${error}`);
      }
    });
  } catch (error) {
    console.error(`Unable to import inline script: ${error}`);
  }
}

function initAttribute() {
  const directive = directives.find(
    (directive) => directive.name === attribute.name
  );
  if (directive != null) {
    owner = directive(node, owner);
  }
}

async function initElement(node, owner) {
  if (owner == null) {
    let parent = node;
    while (parent) {
      if (parent.__owner != null) {
        owner = parent.__owner;
        break;
      }
      parent = parent.parentElement;
    }
  }
  if (node?.nodeType === Node.ELEMENT_NODE) {
    node.__dispose?.();
    for (const attribute of Array.from(node.attributes)) {
      initAttribute
    }
  }
  if (node.firstElementChild) {
    initOrUpdate(
      node.firstElementChild,
      node.__provider || parentProviderState
    );
  }
  if (node.nextElementSibling) {
    initOrUpdate(
      node.nextElementSibling,
      node.__provider || parentProviderState
    );
  }
}

let observer = null;

function start() {
  if (observer) return;
  initOrUpdate(document.body, null);
  observer = new MutationObserver((mutations) => {
    const invalidNodes = [];
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        if (isComponent(mutation.target)) {
          invalidNodes.push(mutation.target);
        } else {
          for (const node of mutation.removedNodes) {
            disposeAll(node);
          }
          if (mutation.nextSibling) {
            invalidNodes.push(mutation.nextSibling);
          }
        }
      } else if (mutation.type === "attributes") {
        if (
          mutation.target.tagName === "SCRIPT" &&
          mutation.attributeName === "context"
        ) {
          invalidNodes.push(mutation.target);
        } else if (directiveNames.includes(mutation.attributeName)) {
          invalidNodes.push(mutation.target);
        }
      } else if (mutation.type === "characterData") {
        if (isComponent(mutation.target.parentElement)) {
          disposeAll(mutation.target.parentElement);
          invalidNodes.push(mutation.target.parentElement);
        }
      }
    }
    for (const node of invalidNodes) {
      let parent = node.parentElement;
      while (parent && !invalidNodes.includes(parent)) {
        parent = parent.parentElement;
      }
      if (!parent) {
        initOrUpdate(node);
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["context", ...directiveNames],
    attributeOldValue: true,
    characterData: true,
  });
}

document.addEventListener("turbo:load", () => {
  start();
});

start();
