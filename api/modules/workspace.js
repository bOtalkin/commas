const { require: requireRenderer } = require('./module')
const { shallowReactive, shallowReadonly, markRaw } = requireRenderer('vue')
const { createIDGenerator } = requireRenderer('utils/helper.mjs')

const tabs = shallowReactive({})
const anchors = shallowReactive([])

const generateID = createIDGenerator()

function registerTabPane(name, pane) {
  tabs[name] = markRaw({
    pid: generateID(),
    process: '',
    title: '',
    cwd: '',
    pane,
  })
}

function getPaneTab(name) {
  return tabs[name]
}

function addAnchor(anchor) {
  anchors.push(anchor)
}

function useAnchors() {
  return shallowReadonly(anchors)
}

module.exports = {
  registerTabPane,
  getPaneTab,
  addAnchor,
  useAnchors,
}
