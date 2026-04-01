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
const INDEX_FILE = path.join(GIT_DIR, 'index');

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
    case "merge":
        merge()
        break;
    case "-h":
        help()
        break;
    default:
        help()
        getIgnoreList()
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
        fs.writeFileSync(INDEX_FILE,"")
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
    entries.forEach(entry=>{
        const fullPath = path.join(dir,entry)

        if(isIgnore(fullPath)) return;
        console.log(fullPath);
        
         if(fs.statSync(fullPath).isFile()){
            calcHash(fullPath)
         }else if(fs.statSync(fullPath).isDirectory()){
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
            if(isIgnore(fullPath)) return;
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
    //获取新分支
    const newHeadRef = path.join(REFS_DIR,'heads',argv[3])
    //判断新分支存不存在
    if(!fs.existsSync(newHeadRef)){
        const currentHeadContent =  fs.readFileSync(HEAD_FILE).toString()
        const currentRefFile = path.join(GIT_DIR,currentHeadContent.split(': ')[1]);
        const currentCommitHash = fs.existsSync(currentRefFile) ? fs.readFileSync(currentRefFile).toString() : null;
        fs.writeFileSync(newHeadRef,currentCommitHash || '')

        fs.writeFileSync(HEAD_FILE,"ref: refs/heads/"+argv[3])
        console.log(`分支 ${argv[3]} 已创建并切换`);
        return;
    }

    //获取最新commit
    const currentHeadContent = fs.readFileSync(HEAD_FILE).toString()
    //当前的分支
    const currentRefFile = path.join(GIT_DIR,currentHeadContent.split(": ")[1]);
    //当前最新提交哈希
    const currentCommitHash = fs.existsSync(currentRefFile) ? fs.readFileSync(currentRefFile).toString() : null

    // 检查工作区脏状态（没有提交的文件）
    const worklistclear = isWorkListClear(currentCommitHash)
    if(worklistclear){
        // 获取目标分支最新commit
        const newHeadRefHash = fs.readFileSync(newHeadRef).toString()
        const files =  fileList(process.cwd())
        files.forEach(item=>{
            console.log(item);
            fs.unlinkSync(item)
        })

        const commitFiles = JSON.parse(fs.readFileSync(path.join(OBJECTS_DIR,newHeadRefHash)).toString())
        for(const item of Object.keys(commitFiles.files)){
            const HashFileContent = fs.readFileSync(path.join(OBJECTS_DIR,commitFiles.files[item])).toString()
            fs.writeFileSync(path.join(process.cwd(),item),HashFileContent);
            fs.writeFileSync(HEAD_FILE,"ref: refs/heads/"+argv[3])
            console.log(`切换到${argv[3]}分支`);
        }
    }
    
}

// 检查工作区的函数
function isWorkListClear(currentCommitHash) {
    if (!currentCommitHash) {
        const workFiles = fileList(process.cwd());
        if (workFiles.length > 0) {
            console.log("仓库为空但工作区有文件，请先提交");
            return false;
        }
        return true;
    }

    // 获取提交文件列表
    const commitFiles = JSON.parse(fs.readFileSync(path.join(OBJECTS_DIR,currentCommitHash)).toString())
    
    //获取工作区所有文件
    const workFiles = fileList(process.cwd())
    // console.log(workFiles);

    //  判断有没有新增文件
    for(const item of workFiles){
        const file = path.relative(process.cwd(),item)
        if(commitFiles.files[file] === undefined){
            console.log("有没有提交的文件，先提交");
            return false;
        }
    }
    //判断是否有被删的文件
    for(const item of Object.keys(commitFiles.files)){
        if(!workFiles.includes(path.join(process.cwd(),item))){
            console.log("工作区有内容没提交，先提交"+item);
            return false;
        }
    }
    //判断文件是否有被修改
    for(const item of workFiles){
        const hash = crypto.createHash('sha1')
        const workFileContent = fs.readFileSync(item)
        const workFileHash = hash.update(workFileContent).digest('hex')
        const xiangduilujing = path.relative(process.cwd(),item)
        if(workFileHash !== commitFiles.files[xiangduilujing]){
            console.log("有个文件修改没有提交，先提交一下");
            return false;
        }
    }
    return true
    
}

function fileList(dir) {
    const entries = fs.readdirSync(dir)
    let filesList = []
    entries.forEach(entry=>{
        const fulPath  = path.join(dir,entry)
        if(isIgnore(fulPath)) return;
        if(fs.statSync(fulPath).isFile()){
            filesList.push(fulPath)
        }else if(fs.statSync(fulPath).isDirectory()){
            const subFiles = fileList(fulPath);
            filesList = filesList.concat(subFiles);
        }
    })
    return filesList;
}


function help() {
    console.log(`
        cue 工具
        所有命令：
        cue init -------------------------------- 初始化仓库
        cue add file/. --------------------------- 添加文件或所有文件
        cue commit "message" ------------------- 提交
        cue commit log ------------------------- 查看提交日记
        cue checkout {commit} file/dir ------------- 回滚文件/文件夹
        cue branch {name} ---------------------  创建分支
        cue brach check {name} ----------------- 切换分支
        cue merge {name} ---------------------- 合并分支
        `);
}

// merge 合并
function merge() {
    const currentrefs = path.join(GIT_DIR,fs.readFileSync(HEAD_FILE).toString().split(': ')[1])
    const targetrefs = path.join(REFS_DIR,"/heads/"+argv[3])
    const targetrefshash = fs.readFileSync(targetrefs).toString()
    fs.writeFileSync(currentrefs,targetrefshash)
    
}


function getIgnoreList(){
    const defaults = ['.mygit', '.git', 'node_modules', 'dist', 'build', '*.exe', '.cueignore'];
    try {
        const userRules = fs.readFileSync('.cueignore').toString().split('\n').map(i=>i.trim()).filter(Boolean);
        return [...new Set([...defaults,...userRules])];
    } catch (error) {
        return defaults
    }
}

function isIgnore(fileOrDir){
    const name = path.basename(fileOrDir);
    const rules = getIgnoreList();
    return rules.some(rule=>{
        if(rule.startsWith('*.')) return fileOrDir.endsWith(rule.slice(1));
        return name === rule;
    })
}