const fs = require("fs");
const path = require("path");
const process = require("process");
const crypto = require("crypto");

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
    default:
        break;
}

// init 操作
function init() {
    if (fs.existsSync(GIT_DIR)) {
        console.log("文件存在");
    } else {
        console.log("文件不存在");
        fs.mkdirSync(GIT_DIR, { recursive: true })
        fs.mkdirSync(OBJECTS_DIR, { recursive: true })
        fs.mkdirSync(REFS_DIR, { recursive: true })
        fs.writeFileSync(HEAD_FILE, "")
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
        console.log(fullPath);
         if(fs.statSync(fullPath).isFile()){
            calcHash(fullPath)
         }else if(fs.statSync(fullPath).isDirectory()){
            console.log("是");
            
            if(entry === '.mygit') return;

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
        let parent
        if(HEAD.length === 0){
            parent = null
        }else{
            parent = HEAD
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
        fs.writeFileSync(HEAD_FILE, hashvalue)
    }else{
        log()
    }
}

// log 操作
function log() {
    const HEAD = fs.readFileSync(HEAD_FILE).toString()
    if(HEAD.length === 0){
        console.log("暂无提交");
        return
    }
    let currentHash = HEAD
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

  // 2. 检查参数是否齐全
  if (!commitHash || !targetName) {
    console.log("用法：node mygit.js checkout 版本号 文件/文件夹名");
    return;
  }

  // 3. 读取commit对象
  const commitPath = path.join(OBJECTS_DIR, commitHash);
  if (!fs.existsSync(commitPath)) {
    console.log("版本不存在！");
    return;
  }
  const commitContent = fs.readFileSync(commitPath, "utf8");
  const commitData = JSON.parse(commitContent);
  const commitFiles = commitData.files;

  // 4. 判断用户输入的是 文件 还是 文件夹
  let isFile = false;
  let isDir = false;

  // 判断是不是文件
  if (commitFiles.hasOwnProperty(targetName)) {
    isFile = true;
  }

  // 判断是不是文件夹
  for (const filePath in commitFiles) {
    if (filePath.startsWith(targetName + "/")) {
      isDir = true;
      break;
    }
  }

  // 5. 开始执行恢复
  if (isFile) {
    console.log("正在恢复文件：" + targetName);
    restoreFile(targetName, commitFiles[targetName]);
  } else if (isDir) {
    console.log("正在恢复文件夹：" + targetName);
    // 遍历所有文件，批量恢复
    for (const filePath in commitFiles) {
      if (filePath.startsWith(targetName + "/")) {
        restoreFile(filePath, commitFiles[filePath]);
      }
    }
  } else {
    console.log("错误：版本中没有这个文件或文件夹");
  }
}

// 【通用工具函数】单独恢复一个文件（自动创建文件夹）
function restoreFile(filePath, blobHash) {
  // 读取文件内容
  const blobPath = path.join(OBJECTS_DIR, blobHash);
  const content = fs.readFileSync(blobPath); // 读取二进制内容

  // 获取文件所在文件夹
  const dirPath = path.dirname(filePath);

  // 文件夹不存在 → 创建
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // 写入文件（覆盖）
  fs.writeFileSync(filePath, content);
}
