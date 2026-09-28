(function () {
  'use strict';

  var STATUSES = { none: true, planned: true, wip: true, done: true };
  var COLORS = { none: true, green: true, orange: true, red: true, blue: true };

  function normalizeNode(source) {
    var node = source || {};
    node.parentId = node.parentId || null;
    node.colIndex = Number.isFinite(Number(node.colIndex)) ? Number(node.colIndex) : 0;
    node.title = typeof node.title === 'string' ? node.title : '';
    node.tags = Array.isArray(node.tags) ? node.tags.filter(function (tag) { return typeof tag === 'string'; }) : [];
    node.status = STATUSES[node.status] ? node.status : 'none';
    node.dueDate = typeof node.dueDate === 'string' ? node.dueDate : '';
    node.note = typeof node.note === 'string' ? node.note : '';
    node.color = COLORS[node.color] ? node.color : 'none';
    node.type = node.type === 'comment' ? 'comment' : 'card';
    node.targetId = node.targetId || null;
    node.children = Array.isArray(node.children) ? node.children : [];
    return node;
  }

  function normalizeNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).map(normalizeNode);
  }

  function createIndex(nodes) {
    var byId = Object.create(null);
    var childrenByParent = Object.create(null);
    var commentsByTarget = Object.create(null);
    var cardsByColumn = Object.create(null);

    nodes.forEach(function (node) {
      byId[node.id] = node;
      if (node.type === 'comment') {
        if (node.targetId && !commentsByTarget[node.targetId]) commentsByTarget[node.targetId] = node;
        return;
      }
      var parentKey = node.parentId || '__root__';
      if (!childrenByParent[parentKey]) childrenByParent[parentKey] = [];
      childrenByParent[parentKey].push(node);
      if (!cardsByColumn[node.colIndex]) cardsByColumn[node.colIndex] = [];
      cardsByColumn[node.colIndex].push(node);
    });

    return {
      byId: byId,
      childrenByParent: childrenByParent,
      commentsByTarget: commentsByTarget,
      cardsByColumn: cardsByColumn
    };
  }

  function payload(state, nextId) {
    return {
      columns: state.columns,
      nodes: state.nodes,
      nextId: nextId,
      availableTags: state.availableTags
    };
  }

  window.KicsModel = {
    normalizeNode: normalizeNode,
    normalizeNodes: normalizeNodes,
    createIndex: createIndex,
    payload: payload
  };
})();