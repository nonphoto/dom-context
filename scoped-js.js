import S from "https://cdn.skypack.dev/s-js";

function textDirective(element, valueStream) {
  S(() => {
    element.textContent = valueStream();
  });
}

const directives = {
  "bind-text": textDirective,
};

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
    element.tagName === "SCRIPT" && element.getAttribute("type") === "context"
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
    Object.keys(directives).some((key) => node.getAttribute(key)) &&
    !node.__consumer
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
  if (providerState) {
    providerState.then((resolved) => {
      S.root((dispose) => {
        const attributeValue = element.getAttribute(attributeName);
        if (resolved.context[attributeValue]) {
          directives[attributeName](element, resolved.context[attributeValue]);
          if (!element.__consumer) {
            element.__consumer = {};
          }
          element.__consumer[attributeName] = dispose;
        }
      });
    });
  }
}

function disposeDirective(element, attributeName) {
  element.__consumer[attributeName]();
}

function initConsumer(element, providerState) {
  if (typeof providerState === "undefined") {
    const provider = getClosestProvider(element);
    providerState = provider ? provider.__provider : null;
  }
  for (const key in directives) {
    const value = element.getAttribute(key);
    if (value) {
      initDirective(element, key, providerState);
    }
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
        const transformedSource = resolvedParentProviderState
          ? `import * as context from "${resolvedParentProviderState.src}"; export * from "${resolvedParentProviderState.src}"; export const disposers = []; stream.context = (...args) => stream.root((disposer) => { disposers.push(disposer); return stream(...args); }); ${source}`
          : source;
        const url = URL.createObjectURL(
          new Blob([transformedSource], { type: "application/javascript" })
        );
        return import(url).then(({ disposers, ...context }) => {
          console.log(context);
          return {
            context,
            src: url,
            disposer: () => {
              disposers.forEach((dispose) => dispose());
            },
          };
        });
      }
    );
  }
  walk(element, (current) => {
    if (scripts.includes(current)) {
      return false;
    } else if (isUninitializedProvider(current)) {
      initProvider(current, element.__provider);
      return false;
    } else if (isUninitializedConsumer(current)) {
      initConsumer(current, element.__provider);
    }
  });
}

function disposeProvider(element) {
  element.__provider.then((context) => {
    context.dispose();
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
  initProvider(parentProvider);
}

function walk(element, callback, context) {
  let current = element.firstElementChild;
  if (callback(element, context) === false) {
    return;
  }
  while (current) {
    walk(current, callback, context || element.__provider);
    current = current.nextElementSibling;
  }
}

function start() {
  window.stream = S;
  initProvider(document.body, null);
  const observer = new MutationObserver((mutations) => {
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
          if (isContextScript(mutation.target)) {
            if (isInitializedProvider(mutation.target.parentElement)) {
              disposeProvider(mutation.target.parentElement);
            }
            initProvider();
          } else {
            if (
              isInitializedDirective(mutation.target, mutation.attributeName)
            ) {
              disposeDirective(mutation.target, mutation.attributeName);
            }
            const newValue = mutation.target.getAttribute(
              mutation.attributeName
            );
            if (newValue && directives[mutation.attributeName]) {
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

start();
