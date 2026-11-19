/* global Zotero, Services */
var registeredMenu = null;
var windowMenus = new Map();
var lifecycle = 0;

function eligible(items) {
  return items?.length === 1 && (items[0].isPDFAttachment() || items[0].isRegularItem());
}

async function openAttachment(items) {
  try {
    if (!eligible(items)) return;
    if (!Zotero.Prefs.get('httpServer.localAPI.enabled')) {
      throw new Error('请先在 Zotero 设置 → 高级中开启“允许此计算机上的其他应用程序与 Zotero 通信”。');
    }
    let attachment = items[0];
    if (!attachment.isPDFAttachment()) {
      const attachments = await attachment.getBestAttachments();
      attachment = attachments.find(item => item.isPDFAttachment());
    }
    if (!attachment || !await attachment.getFilePathAsync()) {
      throw new Error('此条目没有已下载的 PDF。请先在 Zotero 中下载附件，再重试。');
    }
    let library = 'users/0';
    if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
      const group = Zotero.Groups.getByLibraryID(attachment.libraryID);
      if (!group) throw new Error('此文库不支持外部打开。');
      library = 'groups/' + group.id;
    }
    Zotero.launchURL('pdfsandwich://zotero/' + library + '/' + attachment.key);
  } catch (error) {
    Zotero.logError(error);
    Zotero.alert(Zotero.getMainWindow(), 'PDFSandwich', error.message + '\n请确认已安装并启动过 PDFSandwich。');
  }
}

function addWindow(window) {
  if (windowMenus.has(window)) return;
  if (registeredMenu) {
    window.MozXULElement.insertFTLIfNeeded('pdfsandwich.ftl');
    windowMenus.set(window, null);
    return;
  }
  if (Zotero.MenuManager?.registerMenu) return;
  const popup = window.document.getElementById('zotero-itemmenu');
  if (!popup) return;
  const item = window.document.createXULElement('menuitem');
  item.id = 'pdfsandwich-open-pdf';
  item.setAttribute('label', Zotero.locale.startsWith('zh') ? '用 PDFSandwich 打开' : 'Open in PDFSandwich');
  const showing = () => { item.hidden = !eligible(window.ZoteroPane.getSelectedItems()); };
  item.addEventListener('command', () => void openAttachment(window.ZoteroPane.getSelectedItems()));
  popup.addEventListener('popupshowing', showing);
  popup.appendChild(item);
  windowMenus.set(window, {popup,item,showing});
}

function removeWindow(window) {
  const menu = windowMenus.get(window);
  if (menu) {
    menu.popup.removeEventListener('popupshowing', menu.showing);
    menu.item.remove();
  }
  window.document.querySelector('link[href="pdfsandwich.ftl"]')?.remove();
  windowMenus.delete(window);
}

function startup({id}) {
  const version = ++lifecycle;
  // Zotero awaits plugin startup before completing its own initialization.
  // Defer registration without making startup depend on that same promise.
  Zotero.initializationPromise.then(() => {
    if (version !== lifecycle) return;
    if (Zotero.MenuManager?.registerMenu) {
      registeredMenu = Zotero.MenuManager.registerMenu({
        menuID: 'pdfsandwich-open-pdf',
        pluginID: id,
        target: 'main/library/item',
        menus: [{
          menuType: 'menuitem',
          l10nID: 'pdfsandwich-open-pdf',
          onShowing: (_event, context) => context.setVisible(eligible(context.items)),
          onCommand: (_event, context) => void openAttachment(context.items)
        }]
      });
    }
    for (const window of Zotero.getMainWindows()) addWindow(window);
  }).catch(error => Zotero.logError(error));
}
function onMainWindowLoad({window}) { addWindow(window); }
function onMainWindowUnload({window}) { removeWindow(window); }
function shutdown() {
  lifecycle++;
  for (const window of [...windowMenus.keys()]) removeWindow(window);
  if (registeredMenu) Zotero.MenuManager.unregisterMenu(registeredMenu);
  registeredMenu = null;
}
function install() {}
function uninstall() {}
