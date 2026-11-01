# Chrome Web Store Listing — Bookmark Butler

> Last Updated: 2026-11-01

Everything the Chrome Developer Dashboard asks for, ready to copy. Items marked **TODO** still need a decision or a file.

## Store Listing

**Extension Name** (must match `name` in manifest.json)

```
Bookmark Butler
```

**Short Description** (from `description` in manifest.json, max 132 characters)

```
Search and organize bookmarks from a popup, and clean up duplicates, dead links and empty folders.
```

**Category:** Productivity → Tools (choose the closest option the dashboard offers)

**Primary Language:** English. Add Chinese (Simplified) as a second listing language.

**Single Purpose** (Privacy tab, read by reviewers)

```
Helps users find, organize and clean up their Chrome bookmarks.
```

### Detailed Description — English

```
Find, organize and clean up your Chrome bookmarks from a popup.

FEATURES
• Browse your bookmarks as a grid and move through folders
• Search by title, URL or folder, from the popup or from the address bar (type "b", then a space)
• Drag to reorder, or move items into folders
• Select many items at once to move or delete them together
• Find duplicate bookmarks, keeping the oldest copy
• Find links that no longer open. The check runs in the background, so you can close the popup
• Find and remove empty folders
• Undo deletions and moves
• Import and export the standard bookmark file used by Chrome, Edge, Firefox and Safari
• Available in English and Chinese

HOW TO USE
1. Click the extension icon in the toolbar
2. Search, open folders, or drag items to rearrange them
3. Open the Clean up tab to review duplicates, dead links and empty folders
4. Press ? in the popup to see the keyboard shortcuts

Deleting a folder or several items asks first, and any deletion can be undone for 10 minutes.

PRIVACY
Bookmark Butler has no account, no analytics and no server of its own. Your bookmarks stay in Chrome, and your settings stay on your device.

The dead link check only runs when you start it. It requests each bookmarked address directly from that website, without your logins, the same way a browser would. Private network addresses are skipped.

PERMISSIONS
• Read and change your bookmarks: to show, search, organize and clean up your bookmarks
• Access to websites: to check whether your bookmarked links still open, and to fill in the current page when you save it

SUPPORT
Found a bug or have a suggestion? Open an issue at https://github.com/shixiaozhong/bookmark-butler/issues
```

### Detailed Description — 简体中文

```
在弹窗里查找、整理和清理你的 Chrome 书签。

功能
• 以网格方式浏览书签，逐层进入文件夹
• 按标题、网址或文件夹搜索，可以在弹窗里搜，也可以在地址栏搜（输入 b 和空格）
• 拖动调整顺序，或把书签放进文件夹
• 一次选择多项，批量移动或删除
• 查找重复书签，保留最早收藏的一条
• 查找打不开的链接。检测在后台进行，可以关闭弹窗
• 查找并删除空文件夹
• 删除和移动都可以撤销
• 导入和导出 Chrome、Edge、Firefox、Safari 通用的书签文件
• 支持中文和英文

使用方法
1. 点击工具栏上的插件图标
2. 搜索、进入文件夹，或拖动图标调整位置
3. 打开“清理”页，查看重复书签、失效链接和空文件夹
4. 在弹窗里按 ? 查看快捷键

删除文件夹或多项内容前会先确认，所有删除都能在 10 分钟内撤销。

隐私
Bookmark Butler 没有账号、没有统计分析，也没有自己的服务器。你的书签保存在 Chrome 里，设置保存在你的设备上。

失效链接检测只在你点击开始后才运行。它会直接向各个书签所在的网站发起请求，不带登录状态，和浏览器访问网站的方式相同。内网地址会被跳过。

权限说明
• 读取和更改书签：用于显示、搜索、整理和清理书签
• 访问网站：用于检测书签链接是否还能打开，以及在收藏时填入当前页面

支持
发现问题或有建议？请到这里反馈：https://github.com/shixiaozhong/bookmark-butler/issues
```

## Graphics & Assets

| Asset | Dimensions | Status | Notes |
|-------|-----------|--------|-------|
| Store icon (required) | 128×128 PNG | 🟡 Needs update | `icons/icon-128.png` works, but Google asks for 96×96 artwork with 16px of transparent padding. Ours fills the canvas. |
| Screenshot 1 (required) | 1280×800 or 640×400 | ⬜ Not created | Grid view |
| Screenshot 2 | 1280×800 or 640×400 | ⬜ Not created | Multi-select with the action bar |
| Screenshot 3 | 1280×800 or 640×400 | ⬜ Not created | Dead link results |
| Screenshot 4 | 1280×800 or 640×400 | ⬜ Not created | Import and export page |
| Small promo image (optional) | 440×280 | ⬜ Not created | Needed to be featured |
| Marquee image (optional) | 1400×560 | ⬜ Not created | |

The popup is 400×580, so screenshots need it placed on a 1280×800 background. Use real UI with sample bookmarks: no personal data, and no other companies' logos.

## Permissions Justification

Paste each into its field on the Privacy tab.

| Permission | Type | Justification |
|------------|------|---------------|
| `bookmarks` | permissions | The extension's whole purpose is managing the user's bookmarks: it reads them to display and search them, and creates, edits, moves and deletes them when the user asks. |
| `storage` | permissions | Saves on the device: the user's language choice, the last open folder, dead link check progress and results, and the data needed to undo a recent deletion. |
| `alarms` | permissions | Lets a dead link check started by the user continue if Chrome stops the extension's background process during a long check. Only active while a check is running. |
| `favicon` | permissions | Shows each bookmark's site icon in the grid, using icons Chrome already has. |
| `http://*/*`, `https://*/*` | host_permissions | Bookmarks can point to any website, so checking for dead links needs to request any address. Requests are made only after the user starts a check, send no cookies, read only the response status, and skip private network addresses. Also used to read the current tab's address and title when the user saves the current page. |

**Remote code:** No, I am not using remote code. All code ships in the package.

## Privacy & Data Use

### Data Collection

The developer receives no data. There is no server, analytics or third-party service.

- Bookmarks are read and changed only inside Chrome.
- Settings, scan results and undo data are in `chrome.storage.local`, on the device. `chrome.storage.sync` is not used. Changes to bookmarks sync only through the user's own Chrome Sync.
- The dead link check contacts the websites in the user's bookmarks, only when started by the user, without cookies.

**TODO: review the data usage checkboxes.** The suggested answer is to tick none, because nothing leaves the device for the developer. Bookmark URLs are close to the form's "Web history" category, so read the wording on the form before deciding. If unsure, declaring it is the safer choice. Disclosures must match the privacy policy.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL:** TODO. It must be public. Add the text below to this repository as `PRIVACY.md` and link to it, or use GitHub Pages or a public gist. Check that the link opens while signed out.

Draft text (replace the contact line, and update it if data practices change):

```
Privacy Policy for Bookmark Butler

Last updated: 2026-11-01

Bookmark Butler does not collect, sell or share your personal data. It has no accounts, no analytics and no server of its own, and the developer receives no information from it.

Your bookmarks
The extension reads and changes your bookmarks inside Chrome, to show, search, organize and clean them up. If you use Chrome Sync, Chrome syncs those changes as it does for any bookmark change.

Data saved on your device
The extension saves your language choice, the last folder you opened, the progress and results of dead link checks, and the data needed to undo a recent deletion. This stays in the extension's local storage on your device. Removing the extension removes it.

Dead link check
This only runs when you start it. The extension requests each bookmarked address directly from the website it belongs to, to see whether it still responds. No cookies or logins are sent, and private network addresses are skipped. Those websites can see the request, as they would when you visit them.

Import and export
Bookmark files you import or export are handled on your device and are not uploaded anywhere.

Changes
If this policy changes, the updated version will be published at this address with a new date.

Contact
TODO: contact email
```

## Distribution

- **Visibility:** Public. Use Unlisted to try the review first without appearing in search.
- **Regions:** All regions
- **Pricing:** Free

## Developer Info

- **Publisher Name:** TODO
- **Contact Email:** TODO. It has to be verified. The account's email can't be changed later, so consider using one just for publishing.
- **Support:** https://github.com/shixiaozhong/bookmark-butler/issues
- **Homepage:** https://github.com/shixiaozhong/bookmark-butler

## Packaging

```sh
npm run bump patch   # or minor, major, or an exact version
npm run package      # runs the tests, then builds dist/bookmark-butler-<version>.zip
```

Upload that zip. Each new upload needs a higher version.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.2.0 | 2026-11-01 | First store version | Draft |

## Review Notes

### Known Issues / Limitations

- **Broad site access is the most likely thing to slow review.** It's used for a real feature, but Chrome shows it at install as access to all website data. Moving it to an optional permission requested when a dead link check starts would remove that warning, and would need testing, because a permission prompt can close the popup.
- Dead link checks can't detect pages that return success while showing "not found".

### Rejection History

None yet.
