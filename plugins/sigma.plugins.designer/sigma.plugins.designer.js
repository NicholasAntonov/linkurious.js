;(function(undefined) {
  'use strict';

  if (typeof sigma === 'undefined')
    throw 'sigma is not declared';

  // Initialize package:
  sigma.utils.pkg('sigma.plugins');

  var settings = {
    nodes: {},
    edges: {}
  };

  /**
   * Sigma Designer
   * =============================
   *
   * @author Sébastien Heymann <seb@linkurio.us> (Linkurious)
   * @version 0.2
   */

   var _s = null,
       _mappings = null,
       _palette = null,
       _visionOnNodes = null,
       _visionOnEdges = null,
       _visualVars = ['color', 'size', 'label'],
       _activeStyles = {nodes: [], edges: []};

  /**
   * Convert Javascript string in dot notation into an object reference.
   *
   * @param  {object} obj The object.
   * @param  {string} str The string to convert, e.g. 'a.b.etc'.
   * @return {?}          The object reference.
   */
  function strToObjectRef(obj, str) {
    // http://stackoverflow.com/a/6393943
    return str.split('.').reduce(function(obj, i) { return obj[i] }, obj);
  }

  /**
   * Fast deep copy function.
   *
   * @param  {object} o The object.
   * @return {object}   The object copy.
   */
  function deepCopy(o) {
    var copy = Object.create(null);
    for (var i in o) {
      if (typeof o[i] === "object" && o[i] !== null) {
        copy[i] = deepCopy(o[i]);
      }
      else if (typeof o[i] === "function" && o[i] !== null) {
        // clone function:
        eval(" copy[i] = " +  o[i].toString());
        //copy[i] = o[i].bind(_g);
      }

      else
        copy[i] = o[i];
    }
    return copy;
  };

  /**
   * This method will put the values in different bins using a linear scale,
   * for a specified number of bins (i.e. histogram). It will return a
   * dictionnary of bins indexed by the specified values.
   *
   * @param  {array}  values The values.
   * @param  {number} nbins  The number of bins.
   * @return {object}        The histogram.
   */
  function histogram(values, nbins) {
    var numlist,
        min,
        max,
        bin,
        i,
        res = {};

    // sort values by inverse order:
    numlist = values.map(function (val) {
      return parseFloat(val);
    })
    .sort(function(a, b) {
      return a - b;
    });

    min = numlist[0];
    max = numlist[numlist.length - 1];

    numlist.forEach(function(num) {
      bin = Math.floor(nbins * Math.abs(num - min) / Math.abs(max - min));
      bin -= (bin == nbins) ? 1 : 0;
      res[num] = bin;
    });

    return res;
  };


  /**
   * This constructor instanciates a new vision on a specified dataset (nodes
   * or edges).
   *
   * @param  {function} dataset   The dataset. Available options: 'nodes',
   *                              'edges'.
   * @return {Vision}             The vision instance.
   */
  function Vision(dataset) {
    this.key = dataset;

    // rules to map visual variables to data properties:
    this.mappings = {};

    // nodes or edges:
    if (dataset === 'nodes') {
      this.dataset = function(s) {
        return s.graph.nodes();
      }
      this.mappings = _mappings.nodes;
    }
    else if (dataset === 'edges') {
      this.dataset = function(s) {
        return s.graph.edges();
      }
      this.mappings = _mappings.edges;
    }
    else
      throw 'Vision: Unknown dataset ' + dataset;

    // index of data properties:
    this.idx = Object.create(null);

    // histograms of data properties for visual variables:
    this.histograms = {};

    // index of deprecated visions on data properties:
    this.deprecated = {};

    // some original sigma settings:
    this.sigmaSettings = {};

    return this;
  };

  /**
   * This method will index the collection with the specified property, and
   * will compute all styles related to the specified property for each item.
   *
   * @param  {string}  key The property accessor.
   */
  Vision.prototype.update = function(key) {
    var self = this;

    if (key === undefined)
      throw 'Vision.update: Missing property accessor';
    if (typeof key !== 'string')
      throw 'Vision.update: The property accessor "'+ key +'" must be a string.';

    var val,
        byFn,
        schemeFn,
        isSequential = true;

    byFn = function(item, key) { return strToObjectRef(item, key); };
    schemeFn = function(palette, key) { return strToObjectRef(palette, key); }

    // Index the collection:
    this.idx[key] = {};
    this.dataset(_s).forEach(function (item) {
      val = byFn(item, key);
      if (val !== undefined) {
        if (self.idx[key][val] === undefined) {
          self.idx[key][val] = {
            key: val,
            items: [],
            styles: {},
            orig_styles: {}
          };
        }
        self.idx[key][val].items.push(item);
        // check if data is sequential:
        isSequential = (typeof val === 'number') ? isSequential : false;
        // TODO: throw error if is number AND (is NaN or is Infinity)
      }
    });

    this.deprecated[key] = false;

    // Find the max number of occurrence of values:
    var maxOcc = 0;
    for (val in this.idx[key]) {
      maxOcc =
        (maxOcc < this.idx[key][val].items.length) ?
        this.idx[key][val].items.length :
        maxOcc;
    }

    // number of occurrence / max number of occurrences of the value:
    Object.keys(this.idx[key]).forEach(function (val) {
      self.idx[key][val].ratio =
        parseFloat(self.idx[key][val].items.length / maxOcc);
    });

    var format,
        colorHist,
        sizeHist,
        scheme,
        bins,
        visualVars;

    // Visual variables mapped to the specified property:
    visualVars = Object.keys(this.mappings).filter(function (visualVar) {
      return (
        (self.mappings[visualVar]) &&
        (self.mappings[visualVar].by !== undefined) &&
        (self.mappings[visualVar].by.toString() == key)
      );
    });

    // Validate the mappings and compute histograms if needed:
    visualVars.forEach(function (visualVar) {
      switch (visualVar) {
        case 'color':
          scheme = self.mappings.color.scheme;

          if (typeof scheme !== 'string')
            throw 'Vision.update: "color.scheme" must be a string';

          if (isSequential) {
            bins = self.mappings.color.bins || 7;
            self.histograms.color = self.histograms.color || {};
            self.histograms.color[key] = histogram(Object.keys(self.idx[key]), bins);
          }
          break;

        case 'label':
          format = self.mappings.label.format || function(item) {
            return item.label;
          };

          if (typeof format !== 'function')
            throw 'Vision.update: "label.format" must be a function';
          break;

        case 'size':
          if (!isSequential)
            throw 'Vision.update: The values of property "' + key + '" must be numbers only';

          self.histograms.size = self.histograms.size || {};
          self.histograms.size[key] = histogram(
            Object.keys(self.idx[key]),
            (self.mappings.size.bins || 7)
          );
          break;
      }
    });

    // Compute all styles related to the property for each item:
    Object.keys(this.idx[key]).forEach(function (val) {
      visualVars.forEach(function (visualVar) {
        switch (visualVar) {

          case 'color':
            if (isSequential) {
              self.idx[key][val].styles.color = function() {
                var bin = self.histograms.color[key][val];
                return schemeFn(_palette, scheme)[bins][bin];
              };
            }
            else {
              self.idx[key][val].styles.color = function() {
                if (schemeFn(_palette, scheme) === undefined)
                  throw 'Vision.update: The color scheme must be qualitative' +
                    ', i.e. a dict of value => color';

                return schemeFn(_palette, scheme)[val];
              };
            }
            break;

          case 'label':
            self.idx[key][val].styles.label = function(item) {
              return format(byFn(item, key));
            };
            break;

          case 'size':
            self.idx[key][val].styles.size = function() {
              return 1 + self.histograms.size[key][val];
            };
            break;
        }
      });
    });
  };

  /**
   * This method will return the vision on a specified property. It will update
   * the vision on the property if it is deprecated or missing.
   *
   * @param  {string} key  The property accessor.
   * @return {object}      The vision on the property.
   */
  Vision.prototype.get = function (key) {
    if (key === undefined)
      throw 'Vision.get: Missing property accessor';
    if (typeof key !== 'string')
      throw 'Vision.get: The property accessor "'+ key +'" must be a string.';

    // lazy updating:
    if (this.deprecated[key])
      this.update(key);

    // lazy indexing:
    if (this.idx[key] === undefined)
      this.update(key);

    return this.idx[key];
  };

  /**
   * This method will apply a mapping between a visual variable and a property.
   * It will update the vision on the property if it is deprecated or missing.
   * It will stores the original value of the visual variable for each item.
   * If the new value is `undefined`, it will keep the original value.
   * Available visual variables are stored in `_visualVars`.
   *
   * @param {string} visualVar The name of the visual variable.
   * @param {string} key       The property accessor.
   */
  Vision.prototype.applyStyle = function(visualVar, key) {
    if (key === undefined)
      throw 'Vision.applyStyle: Missing property accessor';
    if (typeof key !== 'string')
      throw 'Vision.applyStyle: The property accessor "'+ key +'" must be a string.';

    if (_visualVars.indexOf(visualVar) == -1)
      throw 'Vision.applyStyle: Unknown style "' + visualVar + '"';

    var idxp = this.get(key);

    Object.keys(idxp).forEach(function (val) {
      var o = idxp[val];
      o.items.forEach(function (item) {
        if (item !== undefined &&
            o.styles !== undefined &&
            o.styles[visualVar]) {

          if (!(visualVar in o.orig_styles)) {
            o.orig_styles[visualVar] = item[visualVar];
          }

          var newVal = o.styles[visualVar](item);
          if (newVal !== undefined)
            item[visualVar] = o.styles[visualVar](item);
        }
      });
    });

    if (visualVar === 'size') {
      if (this.key === 'nodes') {
        if (_mappings.nodes.size.min > _mappings.nodes.size.max) {
          throw 'Vision.applyStyle: styles.nodes.size.min must not be ' +
          'greater than styles.nodes.size.max';
        }

        if (_mappings.nodes.size.min) {
          if (!this.sigmaSettings.minNodeSize) {
            this.sigmaSettings.minNodeSize = _s.settings('minNodeSize');
          }
          _s.settings('minNodeSize', _mappings.nodes.size.min);
        }

        if (_mappings.nodes.size.max) {
          if (!this.sigmaSettings.maxNodeSize) {
            this.sigmaSettings.maxNodeSize = _s.settings('maxNodeSize');
          }
          _s.settings('maxNodeSize', _mappings.nodes.size.max);
        }
      }
      else if (this.key === 'edges') {
        if (_mappings.edges.size.min > _mappings.edges.size.max) {
          throw 'Vision.applyStyle: styles.edges.size.min must not be '+
          'greater than styles.edges.size.max';
        }

        if (_mappings.edges.size.min) {
          if (!this.sigmaSettings.minEdgeSize) {
            this.sigmaSettings.minEdgeSize = _s.settings('minEdgeSize');
          }
          _s.settings('minEdgeSize', _mappings.edges.size.min);
        }

        if (_mappings.edges.size.max) {
          if (!this.sigmaSettings.maxEdgeSize) {
            this.sigmaSettings.maxEdgeSize = _s.settings('maxEdgeSize');
          }
          _s.settings('maxEdgeSize', _mappings.edges.size.max);
        }
      }
    }
  };

  /**
   * This method will undo a mapping between a visual variable and a property.
   * It restores the original value of the visual variable for each item. It
   * will do nothing if the vision on the property is missing.
   * Available visual variables are stored in `_visualVars`.
   *
   * @param {string} visualVar The name of the visual variable.
   * @param {string} key       The property accessor.
   */
  Vision.prototype.undoStyle = function(visualVar, key) {
    var self = this;

    if (key === undefined)
      throw 'Vision.undoStyle: Missing property accessor';
    if (typeof key !== 'string')
      throw 'Vision.undoStyle: The property accessor "'+ key +'" must be a string.';

    if (_visualVars.indexOf(visualVar) == -1)
      throw 'Vision.undoStyle: Unknown style';

    if (this.idx[key] === undefined)
      return;

    Object.keys(this.idx[key]).forEach(function (val) {
      var o = self.idx[key][val];
      o.items.forEach(function (item) {
        if (item !== undefined) {

          if (o.orig_styles === undefined)
            delete item[visualVar];
          else
            item[visualVar] = o.orig_styles[visualVar];
        }
      });
      delete o.orig_styles[visualVar];
    });

    if (visualVar === 'size') {
      if (this.key === 'nodes') {
        if (this.sigmaSettings.minNodeSize) {
          _s.settings('minNodeSize', this.sigmaSettings.minNodeSize);
        }
        if (this.sigmaSettings.maxNodeSize) {
          _s.settings('maxNodeSize', this.sigmaSettings.maxNodeSize);
        }
      }
      else if (this.key === 'edges') {
        if (this.sigmaSettings.minEdgeSize) {
          _s.settings('minEdgeSize', this.sigmaSettings.minEdgeSize);
        }
        if (this.sigmaSettings.maxEdgeSize) {
          _s.settings('maxEdgeSize', this.sigmaSettings.maxEdgeSize);
        }
      }
    }
  };


  /**
   * Designer Object
   * ------------------
   * @param  {sigma}   s      The related sigma instance.
   * @param  {?object} specs  The specs object contains `palette` and `styles`.
   *                          Styles are mappings between visual variables and
   *                          data properties on nodes and edges.
   */
  function Designer(s, specs) {
    _s = s;
    _mappings = sigma.utils.extend((specs || {}).styles || {}, settings);
    _palette = (specs || {}).palette || {};

    _visionOnNodes = new Vision('nodes');
    _visionOnEdges = new Vision('edges');

    _s.bind('kill', function() {
      sigma.plugins.killDesigner();
    });
  };

  /**
   * This method will configure the palette and styles. Styles are mappings
   * between visual variables and data properties on nodes and edges. It will
   * deprecate existing styles.
   *
   * @param  {?object}  specs The specs object contains `palette` and `styles`.
   * @return {Designer}       The instance.
   */
  Designer.prototype.extendSpecs = function(specs) {
    _mappings = sigma.utils.extend((specs || {}).styles || _mappings, settings);
    _palette = (specs || {}).palette || _palette;

    _visionOnNodes.mappings = _mappings.nodes;
    _visionOnEdges.mappings = _mappings.edges;

    this.deprecate();
    return this;
  };

  /**
   * This method will export the styles and palette of the designer.
   *
   * @return {Designer}  The instance.
   */
  Designer.prototype.specs = function() {
    return {
      styles: _mappings,
      palette: _palette
    };
  };

  /**
   * This method is used to get the styles bound to each node of the graph for
   * a specified property.
   *
   * @param  {string} key The property accessor. Use a dot notation like
   *                      'data.myProperty'.
   * @return {object}     The styles.
   */
  Designer.prototype.nodes = function(key) {
    return _visionOnNodes.get(key);
  };

  /**
   * This method is used to get the styles bound to each edge of the graph for
   * a specified property.
   *
   * @param  {string} key The property accessor. Use a dot notation like
   *                      'data.myProperty'.
   * @return {object}      The styles.
   */
  Designer.prototype.edges = function(key) {
    return _visionOnEdges.get(key);
  };

  Designer.prototype.inspect = function() {
    return {
      nodes: deepCopy(_visionOnNodes),
      edges: deepCopy(_visionOnEdges)
    };
  };

  /**
   * This method is used to apply all target styles or a specified target
   * style, depending on how it is called.
   * It will refresh the display.
   *
   * @param  {string} target     The data target. Available values:
   *                             "nodes", "edges".
   * @param  {string} visualVar  The visual variable. Available values:
   *                             "color", "size", "label".
   * @return {Designer}            The instance.
   */
  Designer.prototype.make = function(target, visualVar) {
    if (!target)
      throw '"Designer.make": Missing target';

    var m,
        v,
        s;

    switch (target) {
      case 'nodes':
        m = _mappings.nodes;
        v = _visionOnNodes;
        s = _activeStyles.nodes;
        break;
      case 'edges':
        m = _mappings.edges;
        v = _visionOnEdges;
        s = _activeStyles.edges;
        break;
      default:
        throw '"Designer.make": Unknown target ' + target;
    }

    if (!visualVar) {
      // empty active styles:
      s.length = 0;
      // apply all styles if no visual variable is specified:
      Object.keys(m).forEach(function (visuVar) {
        if (m[visuVar] && m[visuVar].by) {
          v.applyStyle(visuVar, m[visuVar].by);

          // add to active styles:
          if (s.indexOf(visuVar) === -1) {
            s.push(visuVar);
          }
        }
      });
    }
    else if (m[visualVar] && m[visualVar].by) {
      // apply the style of the specified visual variable:
      v.applyStyle(visualVar, m[visualVar].by);

      // add to active styles:
      if (s.indexOf(visualVar) === -1) {
        s.push(visualVar);
      }
    }

    //see https://github.com/jacomyal/sigma.js/issues/397
    _s.refresh({skipIndexation: true});

    return this;
  };

  /**
   * This method will apply all styles on nodes and edges.
   *
   * @return {Designer}  The instance.
   */
  Designer.prototype.makeAll = function() {
    this.make('nodes');
    this.make('edges');
    return this;
  };

  /**
   * This method is used to undo all target styles or a specified target style,
   * depending on how it is called.
   * It will refresh the display.
   *
   * @param  {string} target     The data target. Available values:
   *                             "nodes", "edges".
   * @param  {string} visualVar  The visual variable. Available values:
   *                             "color", "size", "label".
   * @return {Designer}  The instance.
   */
  Designer.prototype.omit = function(target, visualVar) {
    if (!target)
      throw '"Designer.omit": Missing target';

    var m,
        v,
        s;

    switch (target) {
      case 'nodes':
        m = _mappings.nodes;
        v = _visionOnNodes;
        s = _activeStyles.nodes;
        break;
      case 'edges':
        m = _mappings.edges;
        v = _visionOnEdges;
        s = _activeStyles.edges;
        break;
      default:
        throw '"Designer.omit": Unknown target ' + target;
    }

    if (!visualVar) {
      // undo all styles if no visual variable is specified:
      Object.keys(m).forEach(function (visuVar) {
        if (s.indexOf(visuVar) !== -1) {
          v.undoStyle(visuVar, m[visuVar].by);
        }
      });
      // empty active styles:
      s.length = 0;
    }
    else if (m[visualVar]) {
      if (s.indexOf(visualVar) !== -1) {
        // undo the style of the specified visual variable:
        v.undoStyle(visualVar, m[visualVar].by);
        // drop from active styles:
        s.splice(s.indexOf(visualVar), 1);
      }
    }

    //see https://github.com/jacomyal/sigma.js/issues/397
    _s.refresh({skipIndexation: true});

    return this;
  };

  /**
   * This method will undo all styles on nodes and edges.
   *
   * @return {Designer}  The instance.
   */
  Designer.prototype.omitAll = function() {
    this.omit('nodes');
    this.omit('edges');
    return this;
  };

  /**
   * This method is used to get the styles currently applied to nodes or edges.
   *
   * @param  {string} target     The data target. Available values:
   *                             "nodes", "edges".
   * @return {array}             The applied styles.
   */
  Designer.prototype.appliedStyles = function(target) {
    if (!target)
      throw '"Designer.appliedStyles": Missing target';

    if (target !== 'nodes' && target !== 'edges')
      throw '"Designer.appliedStyles": Unknown target ' + target;

    return _activeStyles[target];
  };

  /**
   * This method is used to get the histograms computed so far on the
   * properties of nodes or edges. A histogram is an object of pairs
   * (value -> bin).
   *
   * @param  {string} target     The data target. Available values:
   *                             "nodes", "edges".
   * @return {array}             The histograms.
   */
  Designer.prototype.histograms = function(target) {
    if (!target)
      throw '"Designer.histogram": Missing target';

    var v;

    switch (target) {
      case 'nodes':
        v = _visionOnNodes;
        break;
      case 'edges':
        v = _visionOnEdges;
        break;
      default:
        throw '"Designer.histogram": Unknown target ' + target;
    }

    return v.histograms;
  };

  /**
   * This method is used when the styles are deprecated, for instance when the
   * graph has changed. Each property style will be remakeed the next time it
   * is called using `.make()`, `.makeAll()`, `.nodes()`, or `.edges()`.
   *
   * @return {Designer}  The instance.
   */
  Designer.prototype.deprecate = function() {
    Object.keys(_visionOnNodes.deprecated).forEach(function(prop) {
      _visionOnNodes.deprecated[prop] = true;
    });

    Object.keys(_visionOnEdges.deprecated).forEach(function(prop) {
      _visionOnEdges.deprecated[prop] = true;
    });
    return this;
  };

  /**
   * This method is used to clear all styles. It will refresh the display. Use
   * `.omitAll()` instead to undo styles without losing the configuration.
   *
   * @return {Designer}  The instance.
   */
  Designer.prototype.disown = function() {
    this.omitAll();
    _mappings = sigma.utils.extend({}, settings);
    _visionOnNodes = new Vision('nodes');
    _visionOnEdges = new Vision('edges');

    //see https://github.com/jacomyal/sigma.js/issues/397
    _s.refresh({skipIndexation: true});

    return this;
  };


  /**
   * Interface
   * ------------------
   *
   * > var designer = sigma.plugins.designer(s, options);
   */
  var _instance = null;

  /**
   * @param  {sigma}   s       The related sigma instance.
   * @param  {object}  styles  The styles of the designer.
   * @param  {?object} palette The color palette.
   * @return {Designer}          The instance.
   */
  sigma.plugins.designer = function(s, styles, palette) {
    // Create instance if undefined
    if (!_instance) {
      _instance = new Designer(s, styles, palette);
    }
    return _instance;
  };

  /**
   *  This function kills the designer instance.
   */
  sigma.plugins.killDesigner = function() {
    if (_instance instanceof Designer) {
      _instance.disown();
    }
    _instance = null;
    _s = null;
  };

}).call(this);
