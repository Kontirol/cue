const fs = require("fs");
const path = require("path");
const process = require("process");
const crypto = require("crypto");

const GIT_DIR = path.join(process.cwd(), '.cue');
const OBJECTS_DIR = path.join(GIT_DIR, 'objects');
const REFS_DIR = path.join(GIT_DIR, 'refs');
const HEAD_FILE = path.join(GIT_DIR, 'HEAD');
const INDEX_FILE = path.join(GIT_DIR, 'index');

const argv = process.argv;
const cmd = argv[2];

// 命令分发
switch (cmd) {
    case "init": init(); break;
    case "add": add(argv[3]); break;
    case "commit": commit(); break;
    case "checkout": checkout(); break;
    case "status": status(); break;
    case "branch": branch(); break;
    case "switch": switchBranch(); break;   // 新增切换分支命令
    case "merge": merge(); break;
    case "clone": clone(); break;
    case "push": push(); break;
    case "-h":
    case "--help":
        help(); break;
    default:
        help();
        break;
}

// ==================== 辅助函数 ====================

// 获取当前分支名
function getCurrentBranch() {
    const head = fs.readFileSync(HEAD_FILE, 'utf8').trim();
    if (head.startsWith('ref: ')) {
        return head.replace('ref: refs/heads/', '');
    }
    return null; // detached HEAD 状态，本工具暂不支持
}

// 获取当前分支对应的 commit hash
function getCurrentCommitHash() {
    const branch = getCurrentBranch();
    if (!branch) return null;
    const refFile = path.join(REFS_DIR, 'heads', branch);
    if (!fs.existsSync(refFile)) return null;
    const hash = fs.readFileSync(refFile, 'utf8').trim();
    return hash || null;
}

// 读取 commit 对象
function readCommit(hash) {
    const content = fs.readFileSync(path.join(OBJECTS_DIR, hash), 'utf8');
    return JSON.parse(content);
}

// 写入 commit 对象
function writeCommit(commit) {
    const str = JSON.stringify(commit);
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    fs.writeFileSync(path.join(OBJECTS_DIR, hash), str);
    return hash;
}

// 更新当前分支指向的 commit
function updateBranchPointer(commitHash) {
    const branch = getCurrentBranch();
    if (!branch) {
        console.error("不在任何分支上，无法更新");
        return false;
    }
    const refFile = path.join(REFS_DIR, 'heads', branch);
    fs.writeFileSync(refFile, commitHash);
    return true;
}

// 获取工作区所有文件（相对路径）
function getWorkFiles() {
    const results = [];
    function walk(dir) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const full = path.join(dir, entry);
            if (isIgnore(full)) continue;
            const stat = fs.statSync(full);
            if (stat.isFile()) {
                results.push(path.relative(process.cwd(), full));
            } else if (stat.isDirectory()) {
                walk(full);
            }
        }
    }
    walk(process.cwd());
    return results;
}

// 计算文件的 blob hash 并存储，返回 hash
function hashAndStoreFile(relPath) {
    const absPath = path.join(process.cwd(), relPath);
    const content = fs.readFileSync(absPath);
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    const objPath = path.join(OBJECTS_DIR, hash);
    if (!fs.existsSync(objPath)) {
        fs.writeFileSync(objPath, content);
    }
    return hash;
}

// 从 blob hash 恢复文件到指定相对路径
function restoreFileFromBlob(relPath, blobHash) {
    const absPath = path.join(process.cwd(), relPath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = fs.readFileSync(path.join(OBJECTS_DIR, blobHash));
    fs.writeFileSync(absPath, content);
}

// 读取暂存区（返回 Map<相对路径, blobHash>）
function readIndex() {
    const indexMap = new Map();
    if (!fs.existsSync(INDEX_FILE)) return indexMap;
    const content = fs.readFileSync(INDEX_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
        const [relPath, hash] = line.split(' ');
        if (relPath && hash) indexMap.set(relPath, hash);
    }
    return indexMap;
}

// 写入暂存区
function writeIndex(indexMap) {
    const lines = [];
    for (const [relPath, hash] of indexMap.entries()) {
        lines.push(`${relPath} ${hash}`);
    }
    fs.writeFileSync(INDEX_FILE, lines.join('\n'));
}

// 检查工作区是否干净（相对于某个 commit，默认当前 commit）
function isWorkTreeClean(compareHash = null) {
    const targetHash = compareHash || getCurrentCommitHash();
    if (!targetHash) {
        // 没有任何提交时，工作区有文件就算不干净
        return getWorkFiles().length === 0;
    }
    const commit = readCommit(targetHash);
    const workFiles = getWorkFiles();
    const trackedFiles = new Set(Object.keys(commit.files));

    // 检查新增和修改
    for (const rel of workFiles) {
        const blobInCommit = commit.files[rel];
        if (!blobInCommit) return false; // 新增文件
        const currentBlob = hashAndStoreFile(rel);
        if (currentBlob !== blobInCommit) return false; // 修改
    }
    // 检查删除
    for (const rel of trackedFiles) {
        const absPath = path.join(process.cwd(), rel);
        if (!fs.existsSync(absPath)) return false;
    }
    return true;
}

// 获取忽略规则
function getIgnoreList() {
    const defaults = ['.cue', '.git', 'node_modules', 'dist', 'build', '.cueignore'];
    try {
        const userRules = fs.readFileSync('.cueignore', 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        return [...new Set([...defaults, ...userRules])];
    } catch (e) {
        return defaults;
    }
}

function isIgnore(fileOrDir) {
    const name = path.basename(fileOrDir);
    const rules = getIgnoreList();
    return rules.some(rule => {
        if (rule.startsWith('*.')) return fileOrDir.endsWith(rule.slice(1));
        return name === rule;
    });
}

// ==================== 核心命令 ====================

function init() {
    if (fs.existsSync(GIT_DIR)) {
        console.log("仓库已存在");
        return;
    }
    fs.mkdirSync(GIT_DIR, { recursive: true });
    fs.mkdirSync(OBJECTS_DIR, { recursive: true });
    fs.mkdirSync(path.join(REFS_DIR, 'heads'), { recursive: true });
    fs.writeFileSync(path.join(REFS_DIR, 'heads', 'main'), '');
    fs.writeFileSync(HEAD_FILE, 'ref: refs/heads/main');
    fs.writeFileSync(INDEX_FILE, '');
    console.log("初始化成功");
}

function add(target) {
    if (!target) {
        console.log("用法: cue add <文件|目录|.>");
        return;
    }
    const indexMap = readIndex();
    const absTarget = path.resolve(target);
    const stat = fs.statSync(absTarget);
    const filesToAdd = [];

    if (stat.isFile()) {
        filesToAdd.push(path.relative(process.cwd(), absTarget));
    } else if (stat.isDirectory()) {
        // 递归收集所有文件
        function collect(dir) {
            const entries = fs.readdirSync(dir);
            for (const e of entries) {
                const full = path.join(dir, e);
                if (isIgnore(full)) continue;
                const s = fs.statSync(full);
                if (s.isFile()) {
                    filesToAdd.push(path.relative(process.cwd(), full));
                } else if (s.isDirectory()) {
                    collect(full);
                }
            }
        }
        collect(absTarget);
    }

    for (const rel of filesToAdd) {
        const hash = hashAndStoreFile(rel);
        indexMap.set(rel, hash);
        console.log(`added: ${rel}`);
    }
    writeIndex(indexMap);
}

function commit() {
    const msg = argv[3];
    if (!msg || msg === 'log') {
        if (msg === 'log') return log();
        console.log("请提供提交信息: cue commit \"message\"");
        return;
    }

    const indexMap = readIndex();
    if (indexMap.size === 0) {
        console.log("没有可提交的内容，请先 add");
        return;
    }

    const parent = getCurrentCommitHash();
    const commitObj = {
        files: Object.fromEntries(indexMap),
        message: msg,
        time: new Date().toISOString(),
        parent: parent || null
    };

    const newHash = writeCommit(commitObj);
    updateBranchPointer(newHash);
    // 清空暂存区
    writeIndex(new Map());
    console.log(`提交成功: ${newHash}`);
}

function log() {
    let hash = getCurrentCommitHash();
    if (!hash) {
        console.log("暂无提交");
        return;
    }
    const commits = [];
    while (hash) {
        const commit = readCommit(hash);
        commits.push({
            hash: hash,
            date: commit.time,
            message: commit.message
        });
        hash = commit.parent;
    }
    for (const c of commits) {
        console.log(`commit ${c.hash}`);
        console.log(`Date: ${c.date}`);
        console.log(`    ${c.message}\n`);
    }
}

function checkout() {
    const commitHash = argv[3];
    const target = argv[4];
    if (!commitHash || !target) {
        console.log("用法: cue checkout <commit-hash> <文件或目录>");
        return;
    }

    const commit = readCommit(commitHash);
    const targetAbs = path.resolve(target);
    const stat = fs.existsSync(targetAbs) ? fs.statSync(targetAbs) : null;
    const isDir = stat ? stat.isDirectory() : target.endsWith(path.sep) || target.endsWith('/');

    if (isDir || !stat) {
        // 恢复整个目录
        const prefix = target.endsWith(path.sep) ? target.slice(0, -1) : target;
        for (const [rel, blobHash] of Object.entries(commit.files)) {
            if (rel.startsWith(prefix)) {
                restoreFileFromBlob(rel, blobHash);
            }
        }
        console.log(`从 ${commitHash} 恢复了目录 ${target}`);
    } else {
        // 恢复单个文件
        const rel = path.relative(process.cwd(), targetAbs);
        if (!commit.files[rel]) {
            console.error(`文件 ${rel} 不存在于该提交中`);
            return;
        }
        restoreFileFromBlob(rel, commit.files[rel]);
        console.log(`恢复文件: ${rel}`);
    }
}

function status() {
    const branch = getCurrentBranch();
    console.log(`当前分支: ${branch}`);
    const indexMap = readIndex();
    const workFiles = getWorkFiles();
    const currentHash = getCurrentCommitHash();
    const trackedInCommit = currentHash ? Object.keys(readCommit(currentHash).files) : [];

    // 暂存区变化
    if (indexMap.size > 0) {
        console.log("\n要提交的变更：");
        for (const [rel] of indexMap) {
            console.log(`  已暂存: ${rel}`);
        }
    }

    // 未暂存的修改（工作区 vs 暂存区）
    const unstaged = [];
    for (const rel of workFiles) {
        const currentBlob = hashAndStoreFile(rel);
        const stagedBlob = indexMap.get(rel);
        if (stagedBlob && currentBlob !== stagedBlob) {
            unstaged.push(rel);
        } else if (!stagedBlob && trackedInCommit.includes(rel)) {
            // 已跟踪但未暂存且内容有变化
            const commitBlob = currentHash ? readCommit(currentHash).files[rel] : null;
            if (commitBlob && currentBlob !== commitBlob) {
                unstaged.push(rel);
            }
        }
    }
    if (unstaged.length) {
        console.log("\n未暂存的修改：");
        unstaged.forEach(f => console.log(`  修改: ${f}`));
    }

    // 未跟踪文件
    const untracked = workFiles.filter(f => !trackedInCommit.includes(f) && !indexMap.has(f));
    if (untracked.length) {
        console.log("\n未跟踪的文件：");
        untracked.forEach(f => console.log(`  ${f}`));
    }
}

function branch() {
    const subCmd = argv[3];
    if (subCmd === '-d') {
        const branchName = argv[4];
        if (!branchName) {
            console.log("用法: cue branch -d <分支名>");
            return;
        }
        const current = getCurrentBranch();
        if (current === branchName) {
            console.log("不能删除当前分支，请先切换到其他分支");
            return;
        }
        const branchFile = path.join(REFS_DIR, 'heads', branchName);
        if (!fs.existsSync(branchFile)) {
            console.log(`分支 ${branchName} 不存在`);
            return;
        }
        fs.unlinkSync(branchFile);
        console.log(`分支 ${branchName} 已删除`);
        return;
    }

    const newBranch = subCmd;
    if (!newBranch) {
        // 列出所有分支
        const heads = fs.readdirSync(path.join(REFS_DIR, 'heads'));
        const current = getCurrentBranch();
        for (const b of heads) {
            if (b === current) console.log(`* ${b}`);
            else console.log(`  ${b}`);
        }
        return;
    }

    const branchFile = path.join(REFS_DIR, 'heads', newBranch);
    if (fs.existsSync(branchFile)) {
        console.log(`分支 ${newBranch} 已存在，如需切换请使用 "cue switch ${newBranch}"`);
        return;
    }
    const currentHash = getCurrentCommitHash() || '';
    fs.writeFileSync(branchFile, currentHash);
    console.log(`创建分支 ${newBranch} 成功`);
}

function switchBranch() {
    const targetBranch = argv[3];
    if (!targetBranch) {
        console.log("用法: cue switch <分支名>");
        return;
    }
    const branchFile = path.join(REFS_DIR, 'heads', targetBranch);
    if (!fs.existsSync(branchFile)) {
        console.log(`分支 ${targetBranch} 不存在`);
        return;
    }

    // 检查工作区是否干净
    if (!isWorkTreeClean()) {
        console.log("工作区有未提交的修改，请先 commit 或 stash");
        return;
    }

    const targetCommitHash = fs.readFileSync(branchFile, 'utf8').trim();
    if (!targetCommitHash) {
        // 新分支无提交，只切换分支，不动工作区文件（但可以清空？）
        fs.writeFileSync(HEAD_FILE, `ref: refs/heads/${targetBranch}`);
        console.log(`切换到分支 ${targetBranch}（无提交）`);
        return;
    }


    
    const targetCommit = readCommit(targetCommitHash);
    const currentCommitHash = getCurrentCommitHash();
    const currentCommit = currentCommitHash ? readCommit(currentCommitHash) : { files: {} };

    // 计算需要删除、新增、修改的文件
    const targetFiles = new Set(Object.keys(targetCommit.files));
    const currentFiles = new Set(Object.keys(currentCommit.files));

    // 删除在当前分支有、但目标分支没有的文件
    for (const rel of currentFiles) {
        if (!targetFiles.has(rel)) {
            const abs = path.join(process.cwd(), rel);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
    }
    // 恢复目标分支的文件
    for (const [rel, blobHash] of Object.entries(targetCommit.files)) {
        restoreFileFromBlob(rel, blobHash);
    }

    // 更新 HEAD
    fs.writeFileSync(HEAD_FILE, `ref: refs/heads/${targetBranch}`);
    // 清空暂存区（切换分支后暂存区应当为空）
    writeIndex(new Map());
    console.log(`切换到分支 ${targetBranch}`);
}

function merge() {
    const sourceBranch = argv[3];
    if (!sourceBranch) {
        console.log("用法: cue merge <分支名>");
        return;
    }

    const currentBranch = getCurrentBranch();
    if (currentBranch === sourceBranch) {
        console.log("不能合并自身");
        return;
    }

    if (!isWorkTreeClean()) {
        console.log("工作区不干净，请先提交或暂存变更");
        return;
    }

    const sourceFile = path.join(REFS_DIR, 'heads', sourceBranch);
    if (!fs.existsSync(sourceFile)) {
        console.log(`分支 ${sourceBranch} 不存在`);
        return;
    }

    const sourceHash = fs.readFileSync(sourceFile, 'utf8').trim();
    const targetHash = getCurrentCommitHash();
    if (!targetHash) {
        console.log("当前分支没有任何提交，无法合并");
        return;
    }

    // 快速前进（fast-forward）检测：如果 source 是 target 的后代
    let isAncestor = false;
    let walk = sourceHash;
    while (walk) {
        if (walk === targetHash) {
            isAncestor = true;
            break;
        }
        const commit = readCommit(walk);
        walk = commit.parent;
    }

    if (isAncestor) {
        // 目标分支是源分支的祖先，可以直接移动指针
        updateBranchPointer(sourceHash);
        // 更新工作区到源分支
        const sourceCommit = readCommit(sourceHash);
        for (const [rel, blobHash] of Object.entries(sourceCommit.files)) {
            restoreFileFromBlob(rel, blobHash);
        }
        // 清空暂存区
        writeIndex(new Map());
        console.log(`合并成功（fast-forward），当前分支指向 ${sourceHash}`);
        return;
    }

    // 需要创建合并提交（三路合并简化版：直接采用目标分支的文件，冲突时提示）
    // 这里简化：只合并文件，冲突时采用目标分支的版本（或提示）
    const targetCommit = readCommit(targetHash);
    const sourceCommit = readCommit(sourceHash);
    const mergedFiles = { ...targetCommit.files };

    let conflict = false;
    for (const [rel, sourceBlob] of Object.entries(sourceCommit.files)) {
        if (targetCommit.files[rel] && targetCommit.files[rel] !== sourceBlob) {
            console.warn(`冲突: ${rel} 在两个分支中不同，保留当前分支版本`);
            conflict = true;
        } else if (!targetCommit.files[rel]) {
            mergedFiles[rel] = sourceBlob;
        }
    }

    // 应用合并后的文件到工作区和暂存区
    for (const [rel, blobHash] of Object.entries(mergedFiles)) {
        restoreFileFromBlob(rel, blobHash);
    }
    // 更新暂存区
    const newIndex = new Map();
    for (const [rel, blobHash] of Object.entries(mergedFiles)) {
        newIndex.set(rel, blobHash);
    }
    writeIndex(newIndex);

    // 创建合并提交
    const mergeCommit = {
        files: mergedFiles,
        message: `Merge branch '${sourceBranch}' into ${currentBranch}`,
        time: new Date().toISOString(),
        parent: targetHash,
        parent2: sourceHash   // 两个父节点
    };
    const newHash = writeCommit(mergeCommit);
    updateBranchPointer(newHash);
    writeIndex(new Map()); // 提交后清空暂存区
    console.log(`合并完成，提交 ${newHash}${conflict ? '（有冲突，已自动解决）' : ''}`);
}

function clone() {
    const src = argv[3];
    if (!src) {
        console.log("用法: cue clone <源仓库路径>");
        return;
    }
    const dest = process.cwd();
    const srcCue = path.join(src, '.cue');
    if (!fs.existsSync(srcCue)) {
        console.log("源路径不是有效的 cue 仓库");
        return;
    }
    // 复制整个 .cue 目录
    fs.cpSync(srcCue, path.join(dest, '.cue'), { recursive: true, force: true });
    // 复制工作区文件？通常克隆只复制仓库数据，工作区需要 checkout，但为了简单，我们复制所有文件
    // 注意：应避免复制 .cue 自身
    function copyWorkTree(srcDir, destDir) {
        const entries = fs.readdirSync(srcDir);
        for (const e of entries) {
            if (e === '.cue') continue;
            const srcPath = path.join(srcDir, e);
            const destPath = path.join(destDir, e);
            const stat = fs.statSync(srcPath);
            if (stat.isFile()) {
                fs.copyFileSync(srcPath, destPath);
            } else if (stat.isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                copyWorkTree(srcPath, destPath);
            }
        }
    }
    copyWorkTree(src, dest);
    console.log("克隆成功");
}

function push() {
    const targetRepo = argv[3];
    if (!targetRepo) {
        console.log("用法: cue push <目标仓库路径>");
        return;
    }
    const currentBranch = getCurrentBranch();
    if (currentBranch === 'main') {
        console.log("禁止推送 main 分支");
        return;
    }
    const currentHash = getCurrentCommitHash();
    if (!currentHash) {
        console.log("没有可推送的提交");
        return;
    }

    const targetCue = path.join(targetRepo, '.cue');
    if (!fs.existsSync(targetCue)) {
        console.log("目标路径不是 cue 仓库");
        return;
    }

    // 复制 objects
    const objects = fs.readdirSync(OBJECTS_DIR);
    for (const obj of objects) {
        const src = path.join(OBJECTS_DIR, obj);
        const dst = path.join(targetCue, 'objects', obj);
        if (!fs.existsSync(dst)) {
            fs.copyFileSync(src, dst);
        }
    }

    // 复制 refs
    const srcRef = path.join(REFS_DIR, 'heads', currentBranch);
    const dstRef = path.join(targetCue, 'refs', 'heads', currentBranch);
    fs.mkdirSync(path.dirname(dstRef), { recursive: true });
    fs.writeFileSync(dstRef, currentHash);

    // 更新目标仓库的 HEAD ？不自动切换，只是推送分支
    console.log(`推送分支 ${currentBranch} 到 ${targetRepo} 完成`);
}

function help() {
    console.log(`
cue 工具 - 轻量级本地分支管理，专为 AI 并行开发设计

命令：
  cue init                        初始化仓库
  cue add <文件|目录|.>           添加文件到暂存区
  cue commit "message"            提交暂存区
  cue commit log                  查看提交历史
  cue checkout <commit> <文件|目录>  从指定提交恢复文件/目录
  cue status                      查看工作区和暂存区状态
  cue branch                      列出所有分支
  cue branch <新分支名>            创建新分支（不切换）
  cue branch -d <分支名>           删除分支
  cue switch <分支名>              切换分支（自动检查工作区）
  cue merge <分支名>               合并分支到当前分支
  cue clone <源仓库路径>           克隆仓库到当前目录
  cue push <目标仓库路径>          推送当前分支到另一个仓库（非 main）
  cue -h                          显示帮助
`);
}