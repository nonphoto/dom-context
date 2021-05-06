import Stream from "https://cdn.skypack.dev/@nonphoto/s-js";
import * as moduleLexer from "https://cdn.skypack.dev/es-module-lexer";
import get from "https://cdn.skypack.dev/lodash-es/get";

Stream.create = (...args) => {
  const s = Stream.data(...args);
  return [() => s(), (v) => s(v)];
};

window.Stream = Stream;

function textDirective(element, value) {
  if (typeof value === "function") {
    Stream(() => {
      textDirective(element, value(element));
    });
  } else {
    element.textContent = value;
  }
}

function styleDirective(element, map) {
  function set(key, value) {
    if (typeof value === "function") {
      Stream(() => {
        set(key, value(element));
      });
    } else {
      element.style[key] = value;
    }
  }
  for (const [key, value] of map.entries()) {
    set(key, value);
  }
}

function attributeDirective(element, map) {
  function set(key, value) {
    if (typeof value === "function") {
      Stream(() => {
        set(key, value(element));
      });
    } else {
      if (typeof value === "boolean") {
        if (value) {
          element.setAttribute(key, "");
        } else {
          element.removeAttribute(key);
        }
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const [key, value] of map.entries()) {
    set(key, value);
  }
}

function onDirective(element, map) {
  for (const [key, value] of map.entries()) {
    element.addEventListener(key, value);
    Stream.cleanup(() => {
      element.removeEventListener(key, value);
    });
  }
}

function refDirective(element, vector) {
  for (const value of vector) {
    value(element);
    Stream.cleanup(() => {
      value(null);
    });
  }
}

function multirefDirective(element, vector) {
  for (const value of vector) {
    value([...(Stream.sample(value) || []), element]);
    Stream.cleanup(() => {
      value(Stream.sample(value).filter((item) => item !== element));
    });
  }
}

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

function isProvider(element) {
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
  return Stream.asyncRoot(async (disposer) => {
    const context = await import(src);
    return {
      context,
      src,
      disposer,
    };
  });
}

async function initOrUpdate(node, parentProviderState) {
  if (typeof parentProviderState === "undefined") {
    let parent = node.parentElement;
    while (parent) {
      if (isProvider(parent) && parent.__provider) {
        parentProviderState = parent.__provider;
        break;
      }
      parent = parent.parentElement;
    }
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    dispose(node);
    if (isProvider(node)) {
      node.__provider = await runInlineScript(node, parentProviderState);
      parentProviderState = node.__provider;
    }
    for (const attribute of Array.from(node.attributes)) {
      const directive = directives.find(
        (directive) => directive.name === attribute.name
      );
      if (directive) {
        const data = directive.parser(
          attribute.value,
          parentProviderState.context
        );
        if (data) {
          Stream.root((dispose) => {
            directive.callback(node, data);
            if (!node.__consumer) {
              node.__consumer = {};
            }
            node.__consumer[attribute.name] = dispose;
          });
        }
      }
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

function dispose(node) {
  if (node.__provider) {
    node.__provider.disposer();
    delete node.__provider;
  }
  if (node.__consumer) {
    for (const attributeName in node.__consumer) {
      node.__consumer[attributeName]();
    }
    delete node.__consumer;
  }
}

function disposeAll(node) {
  dispose(node);
  for (const child of Array.from(node.childNodes)) {
    disposeAll(child);
  }
}

let observer = null;

function start() {
  if (observer) return;
  initOrUpdate(document.body, null);
  observer = new MutationObserver((mutations) => {
    const invalidNodes = [];
    for (const mutation of mutations) {
      if (
        mutation.target.nodeType === Node.TEXT_NODE &&
        isProvider(mutation.target.parentElement)
      ) {
        invalidNodes.push(mutation.target.parentElement);
      }
      if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        if (mutation.type === "childList") {
          for (const node of mutation.removedNodes) {
            disposeAll(node);
          }
          if (mutation.nextSibling) {
            invalidNodes.push(mutation.nextSibling);
          }
        }
        if (mutation.type === "attributes") {
          if (
            mutation.target.tagName === "SCRIPT" &&
            mutation.attributeName === "context"
          ) {
            invalidNodes.push(mutation.target);
          } else if (directiveNames.includes(mutation.attributeName)) {
            invalidNodes.push(mutation.target);
          }
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
