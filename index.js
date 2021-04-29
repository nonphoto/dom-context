import S from "https://cdn.skypack.dev/s-js";

S.create = (...args) => {
  const s = S.data(...args);
  return [() => s(), (v) => s(v)];
};

window.stream = S;

function textDirective(element, value) {
  if (typeof value === "function") {
    S(() => {
      element.textContent = value(element);
    });
  } else {
    element.textContent = value;
  }
}

function styleDirective(element, value, name) {
  if (typeof value === "function") {
    S(() => {
      styleDirective(element, value(element), name);
    });
  } else {
    element.style[name] = value;
  }
}

function attributeDirective(element, value, name) {
  if (typeof value === "function") {
    S(() => {
      attributeDirective(element, value(element), name);
    });
  } else {
    if (typeof value === "boolean") {
      if (value) {
        element.setAttribute(name, "");
      } else {
        element.removeAttribute(name);
      }
    } else {
      element.setAttribute(name, value);
    }
  }
}

function onDirective(element, value, name) {
  element.addEventListener(name, value);
  S.cleanup(() => {
    element.removeEventListener(name, value);
  });
}

function refDirective(element, value) {
  value(element);
  S.cleanup(() => {
    value(null);
  });
}

function multirefDirective(element, value) {
  value([...(S.sample(value) || []), element]);
  S.cleanup(() => {
    value(S.sample(value).filter((item) => item !== element));
  });
}

const directives = [
  {
    pattern: /bind-text/,
    fn: textDirective,
  },
  {
    pattern: /bind-attr-(\S+)/,
    fn: attributeDirective,
  },
  {
    pattern: /bind-style-(\S+)/,
    fn: styleDirective,
  },
  {
    pattern: /bind-on-(\S+)/,
    fn: onDirective,
  },
  {
    pattern: /bind-ref/,
    fn: refDirective,
  },
  {
    pattern: /bind-multiref/,
    fn: multirefDirective,
  },
];

function getClosestProvider(node) {
  let parent = node.parentElement;
  while (parent) {
    if (isInitializedProvider(parent)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function isContextScript(element) {
  return (
    element.tagName === "SCRIPT" && element.getAttribute("scoped") !== null
  );
}

function isUninitializedProvider(node) {
  return Array.from(node.children).some(isContextScript) && !node.__provider;
}

function isInitializedProvider(node) {
  return !!node.__provider;
}

function isUninitializedConsumer(node) {
  return (
    directives.some(({ pattern }) =>
      Array.from(node.attributes).some(({ name }) => pattern.test(name))
    ) && !node.__consumer
  );
}

function isInitializedConsumer(node) {
  return !!node.__consumer;
}

function isInitializedDirective(node, attributeName) {
  return node.__consumer && node.__consumer[attributeName];
}

function initDirective(element, attributeName, providerState) {
  if (typeof providerState === "undefined") {
    const provider = getClosestProvider(element);
    providerState = provider ? provider.__provider : null;
  }
  if (!element.__consumer) {
    element.__consumer = {};
  }
  const attributeValue = element.getAttribute(attributeName);
  const directive = directives.find(({ pattern }) =>
    pattern.test(attributeName)
  );
  if (directive && !element.__consumer[attributeName] && providerState) {
    providerState.then((resolved) => {
      S.root((dispose) => {
        const [, ...matches] = directive.pattern.exec(attributeName);
        if (resolved.context[attributeValue]) {
          directive.fn(element, resolved.context[attributeValue], ...matches);

          element.__consumer[attributeName] = dispose;
        } else {
          console.warn(
            `value with key "${attributeValue}" not found in context`
          );
        }
      });
    });
  }
}

function disposeDirective(element, attributeName) {
  element.__consumer[attributeName]();
  delete element.__consumer[attributeName];
}

function initConsumer(element, providerState) {
  if (typeof providerState === "undefined") {
    const provider = getClosestProvider(element);
    providerState = provider ? provider.__provider : null;
  }
  for (const { name } of Array.from(element.attributes)) {
    initDirective(element, name, providerState);
  }
}

function disposeConsumer(element) {
  for (const key in element.__consumer) {
    disposeDirective(element, key);
  }
  delete element.__consumer;
}

function initProvider(element, parentProviderState) {
  if (typeof parentProviderState === "undefined") {
    const provider = getClosestProvider(element);
    parentProviderState = provider ? provider.__provider : null;
  }
  const scripts = Array.from(element.children).filter(isContextScript);
  if (isUninitializedProvider(element)) {
    const source = scripts.map((script) => script.textContent).join("\n");
    element.__provider = Promise.resolve(parentProviderState).then(
      (resolvedParentProviderState) => {
        const parentContext = resolvedParentProviderState
          ? resolvedParentProviderState.context
          : {};
        const src = URL.createObjectURL(
          new Blob([source], { type: "application/javascript" })
        );
        return import(src).then((module) => {
          return S.root((disposer) => {
            const context = {
              ...parentContext,
              ...module.default(parentContext),
            };
            return {
              context,
              src,
              disposer,
            };
          });
        });
      }
    );
  }
  walk(element, (current) => {
    if (scripts.includes(current)) {
      return false;
    }
    if (isUninitializedConsumer(current)) {
      initConsumer(current, element.__provider);
    }
    if (isUninitializedProvider(current)) {
      initProvider(current, element.__provider);
      return false;
    }
  });
}

function disposeProvider(element) {
  element.__provider.then((providerState) => {
    providerState.disposer();
  });
  delete element.__provider;
  walk(element, (current) => {
    if (isInitializedProvider(current)) {
      disposeProvider(current);
      return false;
    } else if (isInitializedConsumer(current)) {
      disposeConsumer(current);
    }
  });
  const parentProvider = getClosestProvider(element);
  if (parentProvider) {
    initProvider(parentProvider);
  }
}

function walk(element, callback) {
  let current = element.firstElementChild;
  while (current) {
    if (callback(current) !== false) {
      walk(current, callback);
    }
    current = current.nextElementSibling;
  }
}

let observer = null;

function start() {
  initProvider(document.body, null);
  if (observer) {
    observer.disconnect();
  }
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        if (mutation.type === "childList") {
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                isContextScript(node) &&
                isInitializedProvider(node.parentElement)
              ) {
                disposeProvider(node.parentElement);
              } else if (isInitializedProvider(node)) {
                disposeProvider(node);
              } else if (isInitializedConsumer(node)) {
                disposeConsumer(node);
              }
            }
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                isContextScript(node) &&
                isUninitializedProvider(node.parent)
              ) {
                initProvider(node.parent);
              } else if (isUninitializedProvider(node)) {
                initProvider(node);
              } else if (isUninitializedConsumer(node)) {
                initConsumer(node);
              }
            }
          }
        }
        if (mutation.type === "attributes") {
          if (
            mutation.target.tagName === "SCRIPT" &&
            mutation.target.getAttribute("scoped") === null &&
            mutation.attributeName === "scoped" &&
            mutation.oldValue !== null &&
            isInitializedProvider(mutation.target.parentElement)
          ) {
            disposeProvider(mutation.target.parentElement);
          } else if (
            mutation.target.tagName === "SCRIPT" &&
            mutation.target.getAttribute("scoped") !== null &&
            isUninitializedProvider(mutation.target.parentElement)
          ) {
            initProvider(mutation.target.parentElement);
          } else {
            if (
              isInitializedDirective(mutation.target, mutation.attributeName)
            ) {
              disposeDirective(mutation.target, mutation.attributeName);
            }
            const newValue = mutation.target.getAttribute(
              mutation.attributeName
            );
            if (newValue) {
              initDirective(mutation.target, mutation.attributeName);
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
  });
}

document.addEventListener("turbo:load", () => {
  start();
});

start();
