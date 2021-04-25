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

function isScopedScript(element) {
  return (
    element.tagName === "SCRIPT" && element.getAttribute("type") === "scoped"
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
  const url = URL.createObjectURL(
    new Blob([script.textContent], { type: "application/javascript" })
  );
  const context = await import(url);
  script.parentElement.__context = context;
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
    if (isScopedScript(currentNode)) {
      await initContext(currentNode);
    }
    const context = getClosestContext(currentNode);
    if (context) {
      for (let key of Object.keys(directives)) {
        const value = currentNode.getAttribute(key);
        if (value) {
          initDirective(currentNode, key, context[value]);
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
              if (isScopedScript(node)) {
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
              if (isScopedScript(node)) {
                await initContext(node);
              }
              const context = getClosestContext(node);
              if (context) {
                for (let key of Object.keys(directives)) {
                  const value = node.getAttribute(key);
                  if (value) {
                    initDirective(node, key, context[value]);
                  }
                }
              }
            }
          }
        }
        if (mutation.type === "attributes") {
          if (isScopedScript(mutation.target)) {
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
              context[newValue]
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
