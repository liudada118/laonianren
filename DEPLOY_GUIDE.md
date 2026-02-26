# 老年人筛查系统 Mac mini 部署指南

**版本**: 1.0
**日期**: 2026年02月26日
**作者**: Manus AI

---

## 1. 系统概述

本指南详细说明了如何在Mac mini上部署“老年人筛查系统”。该系统是一个基于Electron的桌面应用程序，集成了Node.js后端、React前端和Python算法服务，通过USB串口设备采集和分析生物力学数据。

部署的核心是将项目打包成一个独立的 `.dmg` 安装文件，用户在Mac mini上安装后即可运行。整个过程分为环境准备、代码构建、打包和权限配置四个主要阶段。

## 2. 环境准备

在开始部署之前，请确保您的Mac mini开发环境满足以下要求。

### 2.1. 硬件与系统

- **设备**: Mac mini (建议配备Apple Silicon芯片以获得最佳性能)
- **操作系统**: macOS 12 (Monterey) 或更高版本

### 2.2. 核心软件

- **Node.js**: `v18.x` 或 `v20.x`。建议使用 [nvm](https://github.com/nvm-sh/nvm) 进行版本管理。
- **Python**: `v3.11.x`。macOS通常自带Python，但建议使用 [pyenv](https://github.com/pyenv/pyenv) 或 [Homebrew](https://brew.sh/) 安装和管理特定版本。
- **Git**: 用于从GitHub克隆代码库。
- **Xcode Command Line Tools**: 提供必要的编译工具。通过运行 `xcode-select --install` 进行安装。

### 2.3. USB串口驱动

系统连接的传感器设备可能需要安装特定的USB转串口驱动程序。请根据您使用的硬件型号，提前下载并安装对应的驱动。常见的驱动包括：

- **CH340/CH341**: 广泛用于各种Arduino兼容板和传感器。 [下载地址](https://sparks.gogo.co.nz/ch340.html)
- **CP210x**: 由Silicon Labs生产，常见于ESP32等开发板。 [下载地址](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- **FTDI**: 另一种常见的USB转串口芯片。驱动通常已内置于macOS中，但如果遇到问题可从 [官网](https://ftdichip.com/drivers/vcp-drivers/) 下载。

安装驱动后，将设备连接到Mac mini的USB端口。打开“终端”应用，运行 `ls /dev/tty.*` 命令，您应该能看到类似 `/dev/tty.usbserial-XXXX` 或 `/dev/tty.wchusbserialXXXX` 的设备文件，这表示驱动已成功加载。

## 3. 部署步骤

部署过程的核心是将项目代码打包成一个可分发的macOS应用程序。

### 3.1. 获取代码

打开终端，克隆最新的项目代码到您的本地目录。

```bash
cd ~/
git clone https://github.com/liudada118/laonianren.git
cd laonianren
```

### 3.2. 安装项目依赖

系统分为前端和后端两个部分，需要分别安装它们的Node.js依赖。

```bash
# 安装后端依赖
cd back-end/code
npm install

# 返回项目根目录，安装前端依赖
cd ../../front-end
npm install

# 返回项目根目录
cd ..
```

### 3.3. 配置Python环境与依赖

后端服务会通过 `pyWorker.js` 调用Python脚本来执行算法。为了确保Python环境的隔离和依赖的正确性，项目配置为使用虚拟环境。

1.  **创建Python虚拟环境**

    在 `back-end/code/python/` 目录下创建一个名为 `venv` 的虚拟环境。

    ```bash
    cd back-end/code/python
    python3.11 -m venv venv
    ```

2.  **激活虚拟环境并安装依赖**

    激活该环境，然后使用 `pip` 安装所有必需的Python库。

    ```bash
    source venv/bin/activate
    pip install numpy scipy opencv-python
    # 确认安装成功
deactivate
    ```

    **重要**: `pyWorker.js` 脚本被配置为在开发模式下自动使用此 `venv` 虚拟环境，在打包后的生产模式下也会将此环境包含进去，因此无需手动修改代码中的Python路径。

### 3.4. 构建与打包应用程序

项目使用 `electron-builder` 工具将整个应用打包成一个 `.dmg` 文件。`package.json` 中已配置好构建脚本。

在 `back-end/code` 目录下执行打包命令：

```bash
cd back-end/code
npm run build:mac
```

此命令会执行以下操作：
1.  `npm run build:renderer`: 使用Vite构建前端React应用，生成静态文件。
2.  `npm run copy:renderer`: 将构建好的前端文件复制到后端目录中，以便Electron加载。
3.  `electron-builder -m`: 将Electron主进程、后端服务、前端界面以及Python虚拟环境一起打包成一个名为 `jqtools2-1.0.0.dmg` (或类似名称) 的文件。

打包完成后，您可以在 `back-end/code/dist/` 目录下找到生成的 `.dmg` 文件。

## 4. 生产环境配置

在将 `.dmg` 文件分发给最终用户或在目标Mac mini上安装后，需要进行关键的生产环境配置。

### 4.1. 禁用测试模式

在开发和测试期间，我们使用了 `VIRTUAL_SERIAL_TEST` 环境变量来模拟设备。在生产环境中，**必须确保此环境变量未被设置**，以便后端服务能够扫描和连接真实的物理串口设备。

由于启动脚本 `index.js` 是通过 `fork` 启动 `serialServer.js` 的，它会传递一些环境变量。请检查 `back-end/code/index.js` 文件，确保在 `fork` `serialServer.js` 时没有传递 `VIRTUAL_SERIAL_TEST` 环境变量。当前代码已符合此要求。

```javascript
// back-end/code/index.js L255
const child = fork(path.join(__dirname, './server/serialServer.js'), {
  silent: false,
  env: {
    isPackaged: isPackaged, // 传递打包状态
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    resourcesPath: process.resourcesPath
    // 确保这里没有 VIRTUAL_SERIAL_TEST: 'true'
  }
})
```

### 4.2. 串口设备权限

在macOS上，应用程序访问USB串口设备通常不需要像Linux那样将用户添加到 `dialout` 组，但可能会受到**应用沙箱 (App Sandbox)** 和 **隐私设置** 的限制。

由于我们的应用是通过 `electron-builder` 打包的，它默认会进行代码签名和沙箱配置。为了确保应用有权访问USB串口，需要配置正确的 **Entitlements**。

1.  **创建Entitlements文件**

    在 `back-end/code/` 目录下创建一个名为 `parent.plist` 的文件，内容如下：

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>com.apple.security.app-sandbox</key>
        <true/>
        <key>com.apple.security.device.serial</key>
        <true/>
      </dict>
    </plist>
    ```

    这里的 `com.apple.security.device.serial` 键是关键，它授予了应用访问串口设备的权限 [1]。

2.  **配置 `electron-builder`**

    修改 `back-end/code/package.json` 文件，在 `build.mac` 配置中指定此entitlements文件。

    ```json
    // back-end/code/package.json
    "build": {
      // ... 其他配置
      "mac": {
        "target": [
          {
            "target": "dmg",
            "arch": ["universal"]
          }
        ],
        "entitlements": "./parent.plist",
        "entitlementsInherit": "./parent.plist"
      }
    }
    ```

    完成此配置后，重新执行 `npm run build:mac` 打包。这样生成的新应用就包含了访问串口的权限。

### 4.3. MAC地址映射文件

对于脚垫等需要通过MAC地址识别的设备，`back-end/code/serial.txt` 文件至关重要。请确保此文件的内容保持最新，包含了所有生产设备的MAC地址与类型的正确映射。

该文件格式为JSON，其中 `key` 字段是一个JSON字符串，内部是MAC地址到设备类型（如 `foot1`, `foot2`）的映射。

```json
// back-end/code/serial.txt
{
  "key": "{\"MAC_ADDR_1\":\"foot1\",\"MAC_ADDR_2\":\"foot2\", ...}",
  "orgName": "机构名称",
  "updatedAt": "更新日期"
}
```

## 5. 运行与验证

1.  将生成的 `.dmg` 文件拷贝到目标Mac mini上。
2.  双击打开，将应用程序图标拖拽到“应用程序”文件夹中完成安装。
3.  将所有传感器设备通过USB连接到Mac mini。
4.  从“应用程序”文件夹中启动“jqtools2”应用。
5.  系统启动后，后端服务会自动扫描并连接所有可用的串口设备。
6.  在前端界面中，进入相应的评估模块，点击“连接设备”，如果状态变为“已连接”，则表示部署成功。

如果遇到连接问题，请检查：
- USB驱动是否已正确安装。
- macOS的“系统设置” -> “隐私与安全性”中，是否阻止了新配件的连接。
- 应用的日志文件，以获取更详细的错误信息。

---

### 参考文献

[1] Apple Developer Documentation. *com.apple.security.device.serial*. [https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_device_serial](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_device_serial)
