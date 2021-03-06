/**
 * Copyright 2013 Facebook, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @providesModule ReactART
 */

"use strict";

require('art/modes/fast'); // Flip this to DOM mode for debugging

var Transform = require('art/core/transform');
var Mode = require('art/modes/current');

var ReactComponent = require('ReactComponent');
var ReactMount = require('ReactMount');
var ReactMultiChild = require('ReactMultiChild');
var ReactDOMComponent = require('ReactDOMComponent');

var ReactComponentMixin = ReactComponent.Mixin;

var flattenChildren = require('flattenChildren'); // Should I use this?
var mixInto = require('mixInto');
var merge = require('merge');

// Used for comparison during mounting to avoid a lot of null checks
var BLANK_PROPS = {};

var pooledTransform = new Transform();

// Utilities

function childrenAsString(children) {
  if (!children) {
    return '';
  }
  if (typeof children === 'string') {
    return children;
  }
  if (children.length) {
    return children.join('\n');
  }
  return '';
}

function createComponent() {
  var ReactARTComponent = function() {};
  for (var i = 0, l = arguments.length; i < l; i++) {
    mixInto(ReactARTComponent, arguments[i]);
  }
  var ConvenienceConstructor = function(props, children) {
    var instance = new ReactARTComponent();
    // Children can be either an array or more than one argument
    instance.construct.apply(instance, arguments);
    return instance;
  };
  return ConvenienceConstructor;
}

// ContainerMixin for components that can hold ART nodes

var ContainerMixin = merge(ReactMultiChild.Mixin, {

  /**
   * Moves a child component to the supplied index.
   *
   * @param {ReactComponent} child Component to move.
   * @param {number} toIndex Destination index of the element.
   * @protected
   */
  moveChild: function(child, toIndex) {
    var childNode = child._mountImage;
    var mostRecentlyPlacedChild = this._mostRecentlyPlacedChild;
    if (mostRecentlyPlacedChild == null) {
      // I'm supposed to be first.
      if (childNode.previousSibling) {
        if (this.node.firstChild) {
          childNode.injectBefore(this.node.firstChild);
        } else {
          childNode.inject(this.node);
        }
      }
    } else {
      // I'm supposed to be after the previous one.
      if (mostRecentlyPlacedChild.nextSibling !== childNode) {
        if (mostRecentlyPlacedChild.nextSibling) {
          childNode.injectBefore(mostRecentlyPlacedChild.nextSibling);
        } else {
          childNode.inject(this.node);
        }
      }
    }
    this._mostRecentlyPlacedChild = childNode;
  },

  /**
   * Creates a child component.
   *
   * @param {ReactComponent} child Component to create.
   * @protected
   */
  createChild: function(child) {
    var childNode = child._mountImage;
    var mostRecentlyPlacedChild = this._mostRecentlyPlacedChild;
    if (mostRecentlyPlacedChild == null) {
      // I'm supposed to be first.
      if (this.node.firstChild) {
        childNode.injectBefore(this.node.firstChild);
      } else {
        childNode.inject(this.node);
      }
    } else {
      // I'm supposed to be after the previous one.
      if (mostRecentlyPlacedChild.nextSibling) {
        childNode.injectBefore(mostRecentlyPlacedChild.nextSibling);
      } else {
        childNode.inject(this.node);
      }
    }
    this._mostRecentlyPlacedChild = childNode;
  },

  /**
   * Removes a child component.
   *
   * @param {ReactComponent} child Child to remove.
   * @protected
   */
  removeChild: function(child) {
    child._mountImage.eject();
  },

  /**
   * Override to bypass batch updating because it is not necessary.
   *
   * @param {?object} nextChildren As returned by `flattenChildren`.
   * @param {ReactReconcileTransaction} transaction
   * @internal
   * @override {ReactMultiChild.Mixin.updateChildren}
   */
  updateChildren: function(nextChildren, transaction) {
    this._mostRecentlyPlacedChild = null;
    this._updateChildren(nextChildren, transaction);
  },

  // Shorthands

  mountAndInjectChildren: function(children, transaction) {
    var mountedImages = this.mountChildren(
      flattenChildren(children),
      transaction
    );
    for (var i = 0; i < mountedImages.length; i++) {
      mountedImages[i].inject(this.node);
    }
  }

});

// Surface - Root node of all ART

var Surface = createComponent(
  ReactDOMComponent.Mixin,
  ReactComponentMixin,
  ContainerMixin, {

  mountComponent: function(rootID, transaction, mountDepth) {
    ReactComponentMixin.mountComponent.call(
      this,
      rootID,
      transaction,
      mountDepth
    );
    transaction.getReactOnDOMReady().enqueue(this, this.componentDidMount);
    // Temporary placeholder
    return '<div ' + ReactMount.ATTR_NAME + '="' + rootID + '"></div>';
  },

  setApprovedDOMProperties: function(nextProps) {
    // TODO: This is a major hack. Either make ART or React internals fit better
    var prevProps = this.props;

    var prevPropsSubset = {
      accesskey: prevProps.accesskey,
      className: prevProps.className,
      draggable: prevProps.draggable,
      role: prevProps.role,
      style: prevProps.style,
      tabindex: prevProps.tabindex,
      title: prevProps.title
    };

    var nextPropsSubset = {
      accesskey: nextProps.accesskey,
      className: nextProps.className,
      draggable: nextProps.draggable,
      role: nextProps.role,
      style: nextProps.style, // TODO: ART's Canvas Mode overrides cursor
      tabindex: nextProps.tabindex,
      title: nextProps.title  // TODO: ART's Canvas Mode overrides surface title
      // TODO: event listeners
    };

    // We hack the internals of ReactDOMComponent to only update some DOM
    // properties that won't override anything important that's internal to ART.
    this.props = nextPropsSubset;
    this._updateDOMProperties(prevPropsSubset);

    // Reset to normal state
    this.props = prevProps;
  },

  componentDidMount: function(node) {
    var props = this.props;

    this.node = Mode.Surface(+props.width, +props.height);
    var surfaceElement = this.node.toElement();

    // Replace placeholder hoping that nothing important happened to it
    if (node.parentNode) {
      node.parentNode.replaceChild(surfaceElement, node);
    }
    ReactMount.setID(surfaceElement, this._rootNodeID);

    this.props = {style:{}};
    this.setApprovedDOMProperties(props);

    var transaction = ReactComponent.ReactReconcileTransaction.getPooled();
    transaction.perform(
      this.mountAndInjectChildren,
      this,
      props.children,
      transaction
    );
    ReactComponent.ReactReconcileTransaction.release(transaction);

    this.props = props;
  },

  receiveProps: function(props, transaction) {
    var node = this.node;

    if (this.props.width != props.width || this.props.width != props.height) {
      node.resize(+props.width, +props.height);
    }

    this.setApprovedDOMProperties(props);

    this.updateChildren(flattenChildren(props.children), transaction);

    if (node.render) {
      node.render();
    }

    this.props = props;
  },

  unmountComponent: function() {
    ReactComponentMixin.unmountComponent.call(this);
    this.unmountChildren();
  }

});

// Various nodes that can go into a surface

var EventTypes = {
  onMouseMove: 'mousemove',
  onMouseOver: 'mouseover',
  onMouseOut: 'mouseout',
  onMouseUp: 'mouseup',
  onMouseDown: 'mousedown',
  onClick: 'click'
};

var NodeMixin = merge(ReactComponentMixin, {

  putEventListener: function(type, listener) {
    var subscriptions = this.subscriptions || (this.subscriptions = {});
    var listeners = this.listeners || (this.listeners = {});
    listeners[type] = listener;
    if (listener) {
      if (!subscriptions[type]) {
        subscriptions[type] = this.node.subscribe(type, listener, this);
      }
    } else {
      if (subscriptions[type]) {
        subscriptions[type]();
        delete subscriptions[type];
      }
    }
  },

  handleEvent: function(event) {
    var listener = this.listeners[event.type];
    if (!listener) {
      return;
    }
    if (typeof listener === 'function') {
      listener.call(this, event);
    } else if (listener.handleEvent) {
      listener.handleEvent(event);
    }
  },

  destroyEventListeners: function() {
    var subscriptions = this.subscriptions;
    if (subscriptions) {
      for (var type in subscriptions) {
        subscriptions[type]();
      }
    }
    this.subscriptions = null;
    this.listeners = null;
  },

  applyNodeProps: function(oldProps, props) {
    var node = this.node;

    var scaleX = props.scaleX != null ? props.scaleX :
                 props.scale != null ? props.scale : 1;
    var scaleY = props.scaleY != null ? props.scaleY :
                 props.scale != null ? props.scale : 1;

    pooledTransform
      .transformTo(1, 0, 0, 1, 0, 0)
      .move(props.x || 0, props.y || 0)
      .rotate(props.rotation || 0, props.originX, props.originY)
      .scale(scaleX, scaleY, props.originX, props.originY);

    if (props.transform != null) {
      pooledTransform.transform(props.transform);
    }

    if (node.xx !== pooledTransform.xx || node.yx !== pooledTransform.yx ||
        node.xy !== pooledTransform.xy || node.yy !== pooledTransform.yy ||
        node.x  !== pooledTransform.x  || node.y  !== pooledTransform.y) {
      node.transformTo(pooledTransform);
    }

    if (props.cursor !== oldProps.cursor || props.title !== oldProps.title) {
      node.indicate(props.cursor, props.title);
    }

    if (node.blend && props.opacity !== oldProps.opacity) {
      node.blend(props.opacity == null ? 1 : props.opacity);
    }

    if (props.visible !== oldProps.visible) {
      if (props.visible == null || props.visible) {
        node.show();
      } else {
        node.hide();
      }
    }

    for (var type in EventTypes) {
      this.putEventListener(EventTypes[type], props[type]);
    }
  },

  mountComponentIntoNode: function(rootID, container) {
    throw new Error(
      'You cannot render an ART component standalone. ' +
      'You need to wrap it in a Surface.'
    );
  }

});

// Group

var Group = createComponent(NodeMixin, ContainerMixin, {

  mountComponent: function(transaction) {
    this.node = Mode.Group();
    this.applyGroupProps(BLANK_PROPS, this.props);
    this.mountAndInjectChildren(this.props.children, transaction);
    return this.node;
  },

  receiveProps: function(props, transaction) {
    this.applyGroupProps(this.props, props);
    this.updateChildren(flattenChildren(props.children), transaction);
    this.props = props;
  },

  applyGroupProps: function(oldProps, props) {
    this.node.width = props.width;
    this.node.height = props.height;
    this.applyNodeProps(oldProps, props);
  },

  unmountComponent: function() {
    this.destroyEventListeners();
    this.unmountChildren();
  }

});

// Renderables

var RenderableMixin = merge(NodeMixin, {

  applyRenderableProps: function(oldProps, props) {
    if (oldProps.fill !== props.fill) {
      if (props.fill && props.fill.applyFill) {
        props.fill.applyFill(this.node);
      } else {
        this.node.fill(props.fill);
      }
    }
    if (
      oldProps.stroke !== props.stroke ||
      oldProps.strokeWidth !== props.strokeWidth ||
      oldProps.strokeCap !== props.strokeCap ||
      oldProps.strokeJoin !== props.strokeJoin
    ) {
      this.node.stroke(
        props.stroke,
        props.strokeWidth,
        props.strokeCap,
        props.strokeJoin
      );
    }
    this.applyNodeProps(oldProps, props);
  },

  unmountComponent: function() {
    this.destroyEventListeners();
  }

});

// Shape

var Shape = createComponent(RenderableMixin, {

  mountComponent: function() {
    this.node = Mode.Shape();
    this.applyShapeProps(BLANK_PROPS, this.props);
    return this.node;
  },

  receiveProps: function(props) {
    this.applyShapeProps(this.props, props);
    this.props = props;
  },

  applyShapeProps: function(oldProps, props) {
    var oldPath = this._oldPath;
    var path = props.d || childrenAsString(props.children);
    if (path !== oldPath ||
        oldProps.width !== props.width ||
        oldProps.height !== props.height) {
      this.node.draw(
        path,
        props.width,
        props.height
      );
      this._oldPath = path;
    }
    this.applyRenderableProps(oldProps, props);
  }

});

// Text

var Text = createComponent(RenderableMixin, {

  mountComponent: function() {
    var props = this.props;
    var newString = childrenAsString(props.children);
    this.node = Mode.Text(newString, props.font, props.alignment, props.path);
    this._oldString = newString;
    this.applyRenderableProps(BLANK_PROPS, this.props);
    return this.node;
  },

  isSameFont: function(oldFont, newFont) {
    if (oldFont === newFont) {
      return true;
    }
    if (typeof newFont === 'string' || typeof oldFont === 'string') {
      return false;
    }
    return (
      newFont.fontSize === oldFont.fontSize &&
      newFont.fontStyle === oldFont.fontStyle &&
      newFont.fontVariant === oldFont.fontVariant &&
      newFont.fontWeight === oldFont.fontWeight &&
      newFont.fontFamily === oldFont.fontFamily
    );
  },

  receiveProps: function(props) {
    var oldProps = this.props;

    var oldString = this._oldString;
    var newString = childrenAsString(props.children);

    if (oldString !== newString ||
        !this.isSameFont(oldProps.font, props.font) ||
        oldProps.alignment !== props.alignment ||
        oldProps.path !== props.path) {
      this.node.draw(
        newString,
        props.font,
        props.alignment,
        props.path
      );
      this._oldString = newString;
    }

    this.applyRenderableProps(oldProps, props);
    this.props = props;
  }

});

// Declarative fill type objects - API design not finalized

var slice = Array.prototype.slice;

var LinearGradient = function(stops, x1, y1, x2, y2) {
  this.args = slice.call(arguments);
};
LinearGradient.prototype.applyFill = function(node) {
  node.fillLinear.apply(node, this.args);
};

var RadialGradient = function(stops, fx, fy, rx, ry, cx, cy) {
  this.args = slice.call(arguments);
};
RadialGradient.prototype.applyFill = function(node) {
  node.fillRadial.apply(node, this.args);
};

var Pattern = function(url, width, height, left, top) {
  this.args = slice.call(arguments);
};
Pattern.prototype.applyFill = function(node) {
  node.fillImage.apply(node, this.args);
};

var ReactART = {

  LinearGradient: LinearGradient,
  RadialGradient: RadialGradient,
  Pattern: Pattern,
  Transform: Transform,
  Path: Mode.Path,
  Surface: Surface,
  Group: Group,
  Shape: Shape,
  Text: Text

};

module.exports = ReactART;
