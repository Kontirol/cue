const fs = require("fs");
const path = require("path");
const process = require("process");
const crypto = require("crypto");
const { blob } = require("stream/consumers");

// const GIT_DIR = 
const GIT_DIR = path.join(process.cwd(), '.mygit');
const OBJECTS_DIR = path.join(GIT_DIR, 'objects');
const REFS_DIR = path.join(GIT_DIR, 'refs');
const HEAD_FILE = path.join(GIT_DIR, 'HEAD');

const argv = process.argv
switch (argv[2]) {
    case "init":
        init()
        break;
    case "add":
        add(argv[3])
        break;
    case "commit":
        commit()
        break;
    case "checkout":
        checkout()
        break;
    case "status":
        status()
        break;
    case "branch":
        branch()
        break;
    default:
        break;
}

// init 操作
function init() {
    if (fs.existsSync(GIT_DIR)) {
        console.log("文件存在");
    } else {
        fs.mkdirSync(GIT_DIR, { recursive: true })
        fs.mkdirSync(OBJECTS_DIR, { recursive: true })
        fs.mkdirSync(REFS_DIR+"/heads/", { recursive: true })
        fs.writeFileSync(REFS_DIR+"/heads/main","")
        fs.writeFileSync(HEAD_FILE, "ref: refs/heads/main")
        console.log("仓库初始化成功");
    }
}

// add操作
function add(file) {
    console.log("你要add 操作，文件是：" + file);
    if (fs.existsSync(file) || file === ".") {
        if (file === ".") {
            const dir = process.cwd()
            traverseDir(dir)
        } else {
            const thisfile = path.join(process.cwd(),file);
            if(fs.statSync(thisfile).isDirectory()){
                traverseDir(thisfile)
            }else{
                calcHash(thisfile)
            }
            
            return;
            // traverseDir(path.join(process.cwd(),file))
        }
    } else {
        console.log("文件不存在");
    }
}

//递归遍历
function traverseDir(dir) {
    const entries = fs.readdirSync(dir);
    console.log(entries);
    entries.forEach(entry=>{
        const fullPath = path.join(dir,entry)
        console.log(fullPath);
         if(fs.statSync(fullPath).isFile()){
            calcHash(fullPath)
         }else if(fs.statSync(fullPath).isDirectory()){
            console.log("是");
            
            if(entry === '.mygit' || entry===".git") return;

            traverseDir(fullPath)
         }
    })
}

// 文件计算哈希
function calcHash(file) {
    const hash = crypto.createHash('sha1')
    const content = fs.readFileSync(file)
    const hashvalue = hash.update(content).digest('hex')
    const relativePath = path.relative( process.cwd(), file )
    fs.writeFileSync(OBJECTS_DIR + '/' + hashvalue, content)
    fs.writeFileSync(GIT_DIR + '/index', relativePath + " " + hashvalue + '\n', { flag: 'a' })
}
//commit 操作
function commit() {
    if (argv[3] !== "log") {
        //  检查暂存区
        const index = fs.readFileSync(GIT_DIR + '/index').toString()
        if(index.length === 0){
            console.log("没有可提交的内容");
            return
        }
        const files = index.split('\n').filter(Boolean);
        let filemap = {}
        files.forEach(item => {
            filemap[item.split(' ')[0]] = item.split(' ')[1]
        })
        const HEAD = fs.readFileSync(HEAD_FILE).toString()
        const refshead = fs.readFileSync(path.join(GIT_DIR,HEAD.split(': ')[1])).toString()
        let parent
        if(refshead.length === 0){
            parent = null
        }else{
            parent = refshead
        }
        
        let object
        object = {
            files: filemap,
            message: argv[3],
            time: new Date().toISOString(),
            parent:parent
        }
        const str = JSON.stringify(object)
        const hashvalue = crypto.createHash('sha1').update(str).digest('hex')
        fs.writeFileSync(OBJECTS_DIR + '/' + hashvalue, str)
        fs.writeFileSync(GIT_DIR + '/index', "")
        fs.writeFileSync(path.join(GIT_DIR,HEAD.split(': ')[1]), hashvalue)
    }else{
        log()
    }
}

// log 操作
function log() {
    const HEAD = fs.readFileSync(HEAD_FILE).toString()
    const refshead = fs.readFileSync(path.join(GIT_DIR,HEAD.split(': ')[1])).toString()
    
    if(refshead.length === 0){
        console.log("暂无提交");
    }
    let currentHash = refshead
    let commit = []

    while(currentHash !== null){
        const object = fs.readFileSync(OBJECTS_DIR+'/'+currentHash).toString()
        const data =  JSON.parse(object)
        let obj = {
            commit : currentHash,
            Date:data.time,
            message:data.message
        }
        commit.push(obj)
        currentHash = data.parent
    }
    console.log(commit);
}



// checkout 操作
// 命令：node mygit.js checkout 【commitHash】 【文件/文件夹名】
function checkout() {
  // 1. 获取命令行参数
  const commitHash = argv[3];    // 版本号
  const targetName = argv[4];    // 要恢复的 文件 / 文件夹

  // 获取版本信息


  const commitblob =JSON.parse(fs.readFileSync(path.join(OBJECTS_DIR,commitHash)).toString())
//   console.log(Object.keys(commitblob.files));
//   console.log(commitblob.files[targetName]);
    if(fs.statSync(targetName).isFile()){
        const hashblob = path.join(OBJECTS_DIR,commitblob.files[targetName])
        restoreFile(hashblob,commitblob.files)
        console.log("回滚成功");
    }else{
        files(targetName,commitblob.files)
    }
}

function files(dir,filelist) {
    
    const entries  = fs.readdirSync(dir)
    
    entries.forEach(entry=>{
            const fullPath = path.join(dir,entry)
            
            if(fs.statSync(fullPath).isFile()){           
                restoreFile(fullPath,filelist[fullPath])                
            }else if(fs.statSync(fullPath).isDirectory()){
                files(fullPath,filelist)
            }
        })
}

// 【通用工具函数】单独恢复一个文件（自动创建文件夹）
function restoreFile(filepath,blobHash) {
    // console.log("文件："+filePath + "\n hash："+blobHash);
    if(blobHash === undefined || blobHash === null){
        // console.log("没有此文件");
        
    }else{
        const blobdata = fs.readFileSync(path.join(OBJECTS_DIR,blobHash)).toString()
        fs.writeFileSync(filepath,blobdata)
    }
}



// status
function status() {
    const HEAD = fs.readFileSync(HEAD_FILE).toString()
    console.log("当前分支："+HEAD);
    
}

// brach
function branch() {
    console.log("branch分支");
    if (argv[3]) {
        //  切换
        if (argv[3] === "check") {
            if (fs.existsSync(path.join(REFS_DIR, '/heads/' + argv[4]))) {
                fs.writeFileSync(HEAD_FILE, "ref: refs/heads/" + argv[4])
                console.log("切换到"+argv[4]+"分支");
                
            }
        } else {
            const HEAD = fs.readFileSync(HEAD_FILE).toString()
            const newcommit = fs.readFileSync(path.join(GIT_DIR,HEAD.split(': ')[1])).toString()
            const branchfile = REFS_DIR + "/heads/" + argv[3];
            if (fs.existsSync(branchfile)) {
                console.log("分支已存在");
            } else {
                fs.writeFileSync(branchfile, newcommit)
                console.log("分支" + argv[3] + "创建成功");
            }
        }
    }

}