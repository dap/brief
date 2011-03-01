/**
 * Original code by Christopher Finke, "OPML Support" extension. Used with permisson.
 */

Components.utils.import('resource://brief/common.jsm');
Components.utils.import('resource://gre/modules/Services.jsm');

IMPORT_COMMON(this);

let opml = {

    init: function() {
        this.historyService   = Cc['@mozilla.org/browser/nav-history-service;1'].
                                getService(Ci.nsINavHistoryService);
        this.bookmarksService = Cc['@mozilla.org/browser/nav-bookmarks-service;1'].
                                getService(Ci.nsINavBookmarksService);
        this.livemarkService  = Cc['@mozilla.org/browser/livemark-service;2'].
                                getService(Ci.nsILivemarkService);
    },

    importOPML: function() {
        let bundle = document.getElementById('options-bundle');

        let fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
        fp.appendFilter(bundle.getString('OPMLFiles'),'*.opml');
        fp.appendFilter(bundle.getString('XMLFiles'),'*.opml; *.xml; *.rdf; *.html; *.htm');
        fp.appendFilter(bundle.getString('allFiles'),'*');

        fp.init(window, bundle.getString('selectFile'), Ci.nsIFilePicker.modeOpen);

        let res = fp.show();

        if (res == Ci.nsIFilePicker.returnOK) {
            // Read any xml file by using XMLHttpRequest.
            // Any character code is converted to native unicode automatically.
            let fix = Cc['@mozilla.org/docshell/urifixup;1'].getService(Ci.nsIURIFixup);
            let url = fix.createFixupURI(fp.file.path, fix.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);

            let reader = new XMLHttpRequest();
            reader.open('GET', url.spec, false);
            reader.overrideMimeType('application/xml');
            reader.send(null);
            let opmldoc = reader.responseXML;

            if (opmldoc.documentElement.localName == 'parsererror') {
                Services.prompt.alert(window, bundle.getString('invalidFileAlertTitle'),
                                      bundle.getString('invalidFileAlertText'));
                return;
            }

            let results = [];

            // At this point, we have an XML doc in opmldoc
            let nodes = opmldoc.getElementsByTagName('body')[0].childNodes;

            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].nodeName == 'outline')
                    results = this.importNode(results, nodes[i]);
            }

            // Now we have the structure of the file in an array.
            let carr = {folders : 0, links : 0, feeds : 0};

            for (let i = 0; i < results.length; i++)
                carr = this.countItems(results[i], carr);

            this.importLevel(results, null);
        }
    },

    importLevel: function(aNodes, aCreateIn) {
        let createIn = aCreateIn;

        // If aCreateIn is null then we are in the root level of the file.
        if (!createIn) {
            let home = document.getElementById('extensions.brief.homeFolder');
            if (home != -1) {
                createIn = home.value;
            }
            else {
                // If there is no home folder set, then import livemarks into the
                // bookmarks folder and set it as the home folder.
                createIn = home.value = this.bookmarksService.bookmarksMenuFolder;
            }
        }

        for (let i = 0; i < aNodes.length; i++) {
            let node = aNodes[i];
            switch (node.type) {
            case 'folder':
                let newCreateIn = this.bookmarksService.createFolder(createIn, node.title, -1);
                this.importLevel(node.children, newCreateIn);
                break;

            case 'feed':
                let siteURI = null, feedURI = null;

                try {
                     feedURI = Services.io.newURI(node.feedURL, null, null);
                }
                catch (ex) {
                    log('Brief\nFailed to import feed ' + node.title +
                        '\nInvalid URI: ' + node.feedURL);
                    break;
                }

                try {
                    siteURI = Services.io.newURI(node.url, null, null);
                }
                catch (ex) {
                    // We can live without siteURI.
                }

                this.livemarkService.createLivemark(createIn, node.title, siteURI,
                                                    feedURI, -1);
                break;

            case 'link':
                try {
                    var uri = Services.io.newURI(node.url, null, null);
                }
                catch (ex) {
                    break;
                }
                this.bookmarksService.insertBookmark(createIn, uri, -1, node.title);
                break;
            }
        }
    },

    countItems: function (arr, carr) {
        if (arr.type == 'folder') {
            carr.folders++;

            for (let i = 0; i < arr.children.length; i++)
                carr = this.countItems(arr.children[i], carr);
        }
        else if (arr.type == 'link') {
            carr.links++;
        }
        else if (arr.type == 'feed') {
            carr.feeds++;
        }

        return carr;
    },

    importNode: function(results, node) {
        let hash = {};
        hash.title = node.getAttribute('text');
        hash.keyword = '';

        if (node.childNodes.length > 0 || (!node.hasAttribute('xmlUrl')
            && !node.hasAttribute('htmlUrl') && !node.hasAttribute('url'))) {

            hash.type = 'folder';
            hash.children = [];

            let children = node.childNodes;

            for (let i = 0; i < children.length; i++) {
                if (children[i].nodeName == 'outline')
                    hash.children = this.importNode(hash.children, children[i]);
            }

            results.push(hash);
        }
        else {
            if (node.getAttribute('type') == 'link') {
                hash.type = 'link';
                hash.url = node.getAttribute('url');
                hash.keyword = node.getAttribute('keyword');
            }
            else {
                hash.type = 'feed';
                hash.feedURL = node.getAttribute('xmlUrl');
                hash.url = node.getAttribute('htmlUrl');
            }

            hash.desc = node.getAttribute('description');

            results.push(hash);
        }

        return results;
    },

    exportOPML: function() {
        let filePrefix = 'feeds';
        let title = 'Feeds';

        let file = this.promptForFile(filePrefix);

        if (file) {
            let home = document.getElementById('extensions.brief.homeFolder').value;
            let folder = (home != -1) ? home
                                      : this.bookmarksService.bookmarksMenuFolder;

            let options = this.historyService.getNewQueryOptions();
            let query = this.historyService.getNewQuery();

            query.setFolders([folder], 1);
            options.excludeItems = true;
            let result = this.historyService.executeQuery(query, options);
            let root = result.root;

            let data = '';
            data += '<?xml version="1.0" encoding="UTF-8"?>' + '\n';
            data += '<opml version="1.0">' + '\n';
            data += '\t' + '<head>' + '\n';
            data += '\t\t' + '<title>' + title + ' OPML Export</title>' + '\n';
            data += '\t\t' + '<dateCreated>' + new Date().toString() + '</dateCreated>' + '\n';
            data += '\t' + '</head>' + '\n';
            data += '\t' + '<body>' + '\n';

            data = this.addFolderToOPML(data, root, 0, true);

            data += '\t' + '</body>' + '\n';
            data += '</opml>';

            // convert to utf-8 from native unicode
            let converter = Cc['@mozilla.org/intl/scriptableunicodeconverter'].
                            getService(Ci.nsIScriptableUnicodeConverter);
            converter.charset = 'UTF-8';
            data = converter.ConvertFromUnicode(data);

            let outputStream = Cc['@mozilla.org/network/file-output-stream;1'].
                               createInstance(Ci.nsIFileOutputStream);

            outputStream.init(file, 0x04 | 0x08 | 0x20, 420, 0 );
            outputStream.write(data, data.length);
            outputStream.close();
        }
    },


    addFolderToOPML: function(dataString, folder, level, isBase) {
        level++;

        if (!isBase) {
            dataString += '\t';

            for (let i = 1; i < level; i++)
                dataString += '\t';

            let name = this.bookmarksService.getItemTitle(folder.itemId);
            dataString += '<outline text="' + this.cleanXMLText(name) + '">' + '\n';
        }

        folder.containerOpen = true;

        for (let i = 0; i < folder.childCount; i++) {
            let node = folder.getChild(i);

            if (node.type != Ci.nsINavHistoryResultNode.RESULT_TYPE_FOLDER)
                continue;

            if (this.livemarkService.isLivemark(node.itemId)) {
                dataString += '\t\t';

                for (let j = 1; j < level; j++)
                    dataString += '\t';

                let name = this.bookmarksService.getItemTitle(node.itemId);
                let url = this.livemarkService.getSiteURI(node.itemId).spec;
                let feedURL = this.livemarkService.getFeedURI(node.itemId).spec

                dataString += '<outline type="rss" version="RSS" '           +
                              'text="'          + this.cleanXMLText(name)    +
                              '" htmlUrl="'     + this.cleanXMLText(url)     +
                              '" xmlUrl="'      + this.cleanXMLText(feedURL) +
                              '"/>' + "\n";
            }
            else if (node instanceof Ci.nsINavHistoryContainerResultNode) {
                dataString = this.addFolderToOPML(dataString, node, level, false);
            }
        }

        folder.containerOpen = false;

        if (!isBase) {
            dataString += '\t';

            for (let i = 1; i < level; i++)
                dataString += '\t';

            dataString += '</outline>' + '\n';
        }

        return dataString;
    },

    promptForFile: function (filePrefix) {
        let bundle = document.getElementById('options-bundle');

        let fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
        fp.init(window, bundle.getString('saveAs'), Ci.nsIFilePicker.modeSave);

        fp.appendFilter(bundle.getString('OPMLFiles'),'*.opml');
        fp.appendFilter(bundle.getString('XMLFiles'),'*.opml; *.xml; *.rdf; *.html; *.htm');
        fp.appendFilter(bundle.getString('allFiles'),'*');

        fp.defaultString = filePrefix + '.opml';

        let result = fp.show();

        if (result == Ci.nsIFilePicker.returnCancel)
            return false;
        else
            return fp.file;
    },

    cleanXMLText: function(str) {
        let res = [
            {find : '&', replace : '&amp;'},
            {find : '"', replace : '&quot;'},
            {find : '<', replace : '&lt;'},
            {find : '>', replace : '&gt;'}
        ]

        for (let i = 0; i < res.length; i++){
            let re = new RegExp(res[i].find, 'g');
            str = str.replace(re, res[i].replace);
        }

        return str;
    }

}
