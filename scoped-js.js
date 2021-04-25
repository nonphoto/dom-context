import S from "https://cdn.skypack.dev/s-js";

function textDirective(element, valueStream) {
  S(() => {
    element.textContent = valueStream();
  });
}

const directives = {
  "bind-text": textDirective,
};

function getClosestContext(node) {
  let parent = node.parentElement;
  while (parent && !parent.__context) {
    parent = parent.parentElement;
  }
  return parent ? parent.__context : null;
}

function isContextScript(element) {
  return (
    element.tagName === "SCRIPT" && element.getAttribute("type") === "context"
  );
}

function initDirective(element, attributeName, contextValue) {
  S.root((dispose) => {
    directives[attributeName](element, contextValue);
    if (!element.__disposers) {
      element.__disposers = {};
    }
    element.__disposers[attributeName] = dispose;
  });
}

async function initContext(script) {
  const parentContext = getClosestContext(script.parentNode);
  const transformedSource = parentContext
    ? `import * as context from "${parentContext.src}"; export * from "${parentContext.src}"; ${script.textContent}`
    : script.textContent;
  const url = URL.createObjectURL(
    new Blob([transformedSource], { type: "application/javascript" })
  );
  const context = await import(url);
  script.parentElement.__context = { values: context, src: url };
}

async function start() {
  window.S = S;
  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    { acceptNode: () => NodeFilter.FILTER_ACCEPT },
    false
  );
  let currentNode = treeWalker.currentNode;
  while (currentNode) {
    if (isContextScript(currentNode)) {
      await initContext(currentNode);
    }
    const context = getClosestContext(currentNode);
    if (context) {
      for (let key of Object.keys(directives)) {
        const value = currentNode.getAttribute(key);
        if (value) {
          initDirective(currentNode, key, context.values[value]);
        }
      }
    }
    currentNode = treeWalker.nextNode();
  }
  const observer = new MutationObserver(async (mutations) => {
    for (let mutation of mutations) {
      if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        if (mutation.type === "childList") {
          for (let node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isContextScript(node)) {
                if (node.parentElement.__context) {
                  delete node.parentElement.__context;
                }
              }
              if (node.__disposers) {
                for (let dispose of node.__disposers) {
                  dispose();
                }
                delete node.__disposers;
              }
            }
          }
          for (let node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isContextScript(node)) {
                await initContext(node);
              }
              const context = getClosestContext(node);
              if (context) {
                for (let key of Object.keys(directives)) {
                  const value = node.getAttribute(key);
                  if (value) {
                    initDirective(node, key, context.values[value]);
                  }
                }
              }
            }
          }
        }
        if (mutation.type === "attributes") {
          if (isContextScript(mutation.target)) {
            if (mutation.target.parentElement.__context) {
              delete mutation.target.parentElement.__context;
            }
            // TODO: Dispose directive elements
          }
          if (
            mutation.target.__disposers &&
            mutation.target.__disposers[mutation.attributeName]
          ) {
            mutation.target.__disposers[mutation.attributeName]();
            delete mutation.target.__disposers[mutation.attributeName];
          }
          const newValue = mutation.target.getAttribute(mutation.attributeName);
          const context = getClosestContext(mutation.target);
          if (newValue && context && directives[mutation.attributeName]) {
            initDirective(
              mutation.target,
              mutation.attributeName,
              context.values[newValue]
            );
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