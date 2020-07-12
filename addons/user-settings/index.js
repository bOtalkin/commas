module.exports = function (commas) {
  if (commas.app.isMainProcess()) {

    commas.i18n.addTranslation(['zh', 'zh-CN'], require('./locales/zh-CN.json'))

  } else {

    commas.workspace.registerTabPane('user-settings', {
      title: 'User Settings#!user-settings.1',
      component: commas.module.require('internal/user-settings/user-settings-pane.vue').default,
      icon: 'feather-icon icon-sliders',
    })

    commas.storage.shareArray('settings').push({
      component: commas.module.require('internal/user-settings/user-settings-link.vue').default,
      group: 'general',
    })

  }
}
