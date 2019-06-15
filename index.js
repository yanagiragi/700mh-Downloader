const rp = require('request-promise')
const cheerio = require('cheerio')
const fs = require('fs-extra')
const path = require('path')
const sanitize = require('sanitize-filename')
const iconv = require('iconv-lite')

const StoragePath = path.join(__dirname, 'Storage')

if (require.main === module)
{
    if(process.argv.length != 3){
        console.log('usage:\tnode index.js $COMICID')
        console.log('e.g.\tnode index.js 1436')
    }
    else {
        Run(process.argv[2])
    }
}

async function ExtractChapterID(comicID) {
    let mainPage = await rp.get(`http://www.700mh.com/manhua/${comicID}/`)
    let $ = cheerio.load(mainPage)
    let title = $('.titleInfo h1').text()
    let id = $('#play_0 li a').toArray().map(x => `http://www.700mh.com/${x.attribs.href}`)
    return [title , id]
}

// from 700mh
function base64decode(str) {
    var base64EncodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var base64DecodeChars = new Array(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1);
    var c1, c2, c3, c4;
    var i, len, out;
    len = str.length;
    i = 0;
    out = "";
    while (i < len) {
        do {
            c1 = base64DecodeChars[str.charCodeAt(i++) & 255]
        } while (i < len && c1 == -1);
        if (c1 == -1) {
            break
        }
        do {
            c2 = base64DecodeChars[str.charCodeAt(i++) & 255]
        } while (i < len && c2 == -1);
        if (c2 == -1) {
            break
        }
        out += String.fromCharCode((c1 << 2) | ((c2 & 48) >> 4));
        do {
            c3 = str.charCodeAt(i++) & 255;
            if (c3 == 61) {
                return out
            }
            c3 = base64DecodeChars[c3]
        } while (i < len && c3 == -1);
        if (c3 == -1) {
            break
        }
        out += String.fromCharCode(((c2 & 15) << 4) | ((c3 & 60) >> 2));
        do {
            c4 = str.charCodeAt(i++) & 255;
            if (c4 == 61) {
                return out
            }
            c4 = base64DecodeChars[c4]
        } while (i < len && c4 == -1);
        if (c4 == -1) {
            break
        }
        out += String.fromCharCode(((c3 & 3) << 6) | c4)
    }
    return out
};

// from 700mh
function decode(p, a, c, k, e, d) {
    e = function(c) {
        return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36))
    };
    if (!''.replace(/^/, String)) {
        while (c--) {
            d[e(c)] = k[c] || e(c)
        }
        k = [function(e) {
            return d[e]
        }];
        e = function() {
            return '\\w+'
        };
        c = 1
    };
    while (c--) {
        if (k[c]) {
            p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c])
        }
    }
    return p
}

async function extractPhotoSr(url){
    try {
        let page = await rp.get(url).catch(err => { throw err })
        let packed = page.match(/packed="(.*)";/)
        if(!packed){
            throw new Error(`Failed To Parse ${url}`)
        } else {
            packed = packed[1]
        }

        let photosrStr = base64decode(packed).slice(4)
        let args = photosrStr.substring(photosrStr.indexOf('return p}(') + 'return p}('.length, photosrStr.length - 3).split(',')

        // get rid of ' in '${args[0]}'
        args[0] = args[0].substring(1, args[0].length - 1)
        args[3] = args[3].substring(0, args[3].lastIndexOf('.'))
        args[3] = args[3].substring(1, args[3].length - 1)
        args[3] = args[3].split('|')
        
        let photosr = decode(args[0], 45, 45, args[3], 0, {}).split(';')
            .filter(x => x.length > 0)
            .map(x => x.match(/"(.*)"/)[1])
        
        let title = cheerio.load(page)('#position-common a[href*=html]').text()    
        return [title, photosr]
    } 
    catch(err) {
        throw err
    }    
}

function Download(url, folderpath) {
    return new Promise(async (resolve, reject) => {
        try{
            let [title, photoSr] = await extractPhotoSr(url).catch(err => {
                resolve([])
            })

            let storeFolderPath = path.join(folderpath, title)
            fs.ensureDirSync(storeFolderPath)

            let tasks = photoSr.map(async (x, idx) => {
                let filename = path.join(storeFolderPath, `${idx}.jpg`)
                if(fs.existsSync(filename)){
                    return
                }
                try {
                    let r = await rp.get({ url: `http://katui.700mh.com/${x}`, encoding: 'binary'})   
                    fs.writeFileSync(filename, r, 'binary')
                } catch(err) {
                    console.log(`err ${url} -> http://katui.700mh.com/${x}`)
                }
            })

            Promise.all(tasks).then(() => resolve(photoSr))
        }
        catch(err) {
            console.log(err.stack)
            reject(err)
        }
    })    
}

function GetUrlInfo(url) {
    return new Promise(async (resolve, reject) => {
        try{
            let [title, photoSr] = await extractPhotoSr(url).catch(err => {
                resolve([])
            })

            Promise.all([]).then(() => resolve(photoSr))
        }
        catch(err) {
            console.log(err.stack)
            reject(err)
        }
    })    
}

async function Run(comicID){
    let [title, chapterID] = await ExtractChapterID(comicID)
    
    fs.ensureDirSync(StoragePath)
    let folderPath = path.join(StoragePath, sanitize(title))
    fs.ensureDirSync(folderPath)

    chapterID = chapterID.reverse()

    // Get Info
    let container = {}
    Promise.all(chapterID.map(async (ele, idx) => {
        let result = await GetUrlInfo(ele)
        container[idx] = result
    })).then(() => {
        console.log(JSON.stringify(container, null, 4))
    })

    // Download
    Promise.all(chapterID.map(async (ele, idx) => {
        let result = await Download(ele)
    })).then(() => {
        
    })
    
}