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
