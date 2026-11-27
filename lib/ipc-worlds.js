'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { replaceLevelName, validateDatapackArchive } = require('./world-management');
const { listWorlds } = require('./activity-store');
const { copyInstanceTransactional } = require('./instance-transfer');

function registerWorldsIPC({
  ipcMain,
  dialog,
  shell,
  getMainWindow,
  BACKUPS_DIR,
  runBackupInWorker,
  listWorldsInWorker,
  compareSemver,
  sanitizeName,
  resolveSafePath,
  safeRemoteFilename,
  ensureDir,
  getInstanceDir,
  getInstanceDirByName,
  getRegisteredInstance,
  getActiveInstanceName,
  modrinthFetch,
  fetchWithRetry,
}) {
  function safeWorldIdentifier(value) {
    const folder = String(value || '').trim();
    if (!folder || folder === '.' || folder === '..' || path.basename(folder) !== folder || /[\r\n\0]/.test(folder)) {
      throw new Error('Invalid world folder');
    }
    return folder;
  }

  function worldDatapacksDirectory(instanceName, identifier) {
    return resolveSafePath(getInstanceDirByName(sanitizeName(instanceName), 'saves'), safeWorldIdentifier(identifier), 'datapacks');
  }

  function backupWorldsBeforeDatapack(instance, label) {
    if (getActiveInstanceName() === instance.name) throw new Error('Close Minecraft before changing a world data pack');
    return runBackupInWorker('create', { backupsDir: BACKUPS_DIR, instance, instanceDir: getInstanceDir(instance), scope: 'worlds', kind: 'automatic', reason: label, retention: instance.backupRetention || 5 });
  }

  ipcMain.handle('get-instance-worlds', async (_, instanceName) => {
    const savesDir = getInstanceDirByName(sanitizeName(instanceName), 'saves');
    try {
      return (await fs.promises.readdir(savesDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  });

  ipcMain.handle('get-instance-world-details', async (_, instanceName) => {
    const { instance } = getRegisteredInstance(instanceName);
    const [worlds] = await listWorldsInWorker([getInstanceDir(instance, 'saves')]);
    return worlds.map(world => ({ ...world, downgradeRisk: Boolean(world.version && compareSemver(world.version, instance.gameVersion) > 0) }));
  });

  ipcMain.handle('get-world-launch-risk', async (_, instanceName, identifier) => {
    const { instance } = getRegisteredInstance(instanceName);
    const folder = safeWorldIdentifier(identifier);
    const [worlds] = await listWorldsInWorker([getInstanceDir(instance, 'saves')]);
    const world = worlds.find(item => item.identifier === folder);
    if (!world) throw new Error('World not found');
    return { risk: Boolean(world.version && compareSemver(world.version, instance.gameVersion) > 0), worldVersion: world.version, instanceVersion: instance.gameVersion, name: world.name };
  });

  ipcMain.handle('rename-world', async (_, instanceName, identifier, requestedName) => {
    const safeName = sanitizeName(instanceName);
    if (getActiveInstanceName() === safeName) throw new Error('Close Minecraft before renaming a world');
    const { instance } = getRegisteredInstance(safeName);
    const levelFile = resolveSafePath(getInstanceDir(instance, 'saves'), safeWorldIdentifier(identifier), 'level.dat');
    if (!fs.existsSync(levelFile)) throw new Error('World metadata was not found');
    await runBackupInWorker('create', { backupsDir: BACKUPS_DIR, instance, instanceDir: getInstanceDir(instance), scope: 'worlds', kind: 'automatic', reason: `Before renaming world ${identifier}`, retention: instance.backupRetention || 5 });
    const updated = replaceLevelName(fs.readFileSync(levelFile), requestedName);
    const temporary = `${levelFile}.${process.pid}.tmp`;
    const previous = `${levelFile}.${process.pid}.previous`;
    fs.writeFileSync(temporary, updated);
    try {
      fs.renameSync(levelFile, previous);
      fs.renameSync(temporary, levelFile);
      fs.rmSync(previous, { force: true });
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (!fs.existsSync(levelFile) && fs.existsSync(previous)) fs.renameSync(previous, levelFile);
      throw error;
    }
    return listWorlds(getInstanceDir(instance, 'saves')).find(world => world.identifier === identifier);
  });

  ipcMain.handle('open-instance-screenshots', async (_, instanceName) => {
    const folder = getInstanceDirByName(sanitizeName(instanceName), 'screenshots');
    ensureDir(folder);
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('install-world-datapack-file', async (_, instanceName, identifier) => {
    const { instance } = getRegisteredInstance(instanceName);
    const result = await dialog.showOpenDialog(getMainWindow(), { title: 'Choose a Minecraft data pack', properties: ['openFile'], filters: [{ name: 'Minecraft data pack', extensions: ['zip'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    validateDatapackArchive(source);
    const targetDir = worldDatapacksDirectory(instance.name, identifier);
    ensureDir(targetDir);
    const target = resolveSafePath(targetDir, safeRemoteFilename(path.basename(source)));
    if (fs.existsSync(target)) throw new Error('A data pack with this filename is already installed in the world');
    await backupWorldsBeforeDatapack(instance, `Before adding data pack to ${identifier}`);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(source, temporary);
    validateDatapackArchive(temporary);
    fs.renameSync(temporary, target);
    return { filename: path.basename(target) };
  });

  ipcMain.handle('install-modrinth-datapack', async (_, instanceName, identifier, requestedProjectId) => {
    const { instance } = getRegisteredInstance(instanceName);
    const projectId = String(requestedProjectId || '').trim().slice(0, 120);
    const project = await modrinthFetch(`/project/${encodeURIComponent(projectId)}`);
    if (project.project_type !== 'datapack') throw new Error('That Modrinth project is not a data pack');
    const versions = await modrinthFetch(`/project/${encodeURIComponent(project.id)}/version?game_versions=${encodeURIComponent(JSON.stringify([instance.gameVersion]))}`);
    const version = versions.find(item => item.files?.length);
    const file = version?.files?.find(item => item.primary) || version?.files?.[0];
    if (!file?.url || new URL(file.url).protocol !== 'https:') throw new Error(`No compatible download is available for Minecraft ${instance.gameVersion}`);
    const targetDir = worldDatapacksDirectory(instance.name, identifier);
    ensureDir(targetDir);
    const target = resolveSafePath(targetDir, safeRemoteFilename(file.filename));
    if (fs.existsSync(target)) throw new Error('This data pack is already installed in the world');
    await backupWorldsBeforeDatapack(instance, `Before adding ${project.title || 'data pack'} to ${identifier}`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await fetchWithRetry(file.url, temporary, () => {});
      const algorithm = file.hashes?.sha512 ? 'sha512' : file.hashes?.sha1 ? 'sha1' : null;
      if (algorithm) {
        const actual = crypto.createHash(algorithm).update(fs.readFileSync(temporary)).digest('hex');
        if (actual !== file.hashes[algorithm]) throw new Error('The downloaded data pack did not pass verification');
      }
      validateDatapackArchive(temporary);
      fs.renameSync(temporary, target);
    } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
    return { filename: path.basename(target), title: project.title };
  });

  ipcMain.handle('open-world-folder', async (_, instanceName, identifier) => {
    const folder = resolveSafePath(getInstanceDirByName(sanitizeName(instanceName), 'saves'), safeWorldIdentifier(identifier));
    if (!fs.existsSync(folder)) throw new Error('World not found');
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('duplicate-world', async (_, instanceName, identifier) => {
    const safeName = sanitizeName(instanceName);
    if (getActiveInstanceName() === safeName) throw new Error('Close Minecraft before duplicating a world');
    const savesDir = getInstanceDirByName(safeName, 'saves');
    const sourceFolder = safeWorldIdentifier(identifier);
    const source = resolveSafePath(savesDir, sourceFolder);
    if (!fs.existsSync(source)) throw new Error('World not found');
    let suffix = ' Copy';
    let destination = resolveSafePath(savesDir, `${sourceFolder}${suffix}`);
    let number = 2;
    while (fs.existsSync(destination)) destination = resolveSafePath(savesDir, `${sourceFolder}${suffix} ${number++}`);
    const result = await copyInstanceTransactional({ source, destination });
    return { identifier: path.basename(destination), files: result.files, bytes: result.bytes };
  });

  ipcMain.handle('delete-world', async (_, instanceName, identifier) => {
    const safeName = sanitizeName(instanceName);
    if (getActiveInstanceName() === safeName) throw new Error('Close Minecraft before deleting a world');
    const { instance } = getRegisteredInstance(safeName);
    const world = resolveSafePath(getInstanceDir(instance, 'saves'), safeWorldIdentifier(identifier));
    if (!fs.existsSync(world)) throw new Error('World not found');
    await runBackupInWorker('create', { backupsDir: BACKUPS_DIR, instance, instanceDir: getInstanceDir(instance), scope: 'worlds', kind: 'automatic', reason: `Before deleting world ${path.basename(world)}`, retention: instance.backupRetention || 5 });
    fs.rmSync(world, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('export-world', async (_, instanceName, identifier) => {
    const safeName = sanitizeName(instanceName);
    const folder = safeWorldIdentifier(identifier);
    const source = resolveSafePath(getInstanceDirByName(safeName, 'saves'), folder);
    if (!fs.existsSync(source)) throw new Error('World not found');
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Export Minecraft world',
      defaultPath: `${folder}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const archive = new AdmZip();
    archive.addLocalFolder(source, folder);
    archive.writeZip(result.filePath);
    return result.filePath;
  });
}

module.exports = {
  registerWorldsIPC,
};
