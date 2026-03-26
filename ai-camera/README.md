# AI Camera IMX500

## Camera setup on Raspberry Pi 5

The Sony IMX500 is a specialized camera module designed for edge AI applications. It features an integrated AI processing unit that allows for on-device inference, making it ideal for real-time applications without the need for cloud processing.

```bash
# Update and install dependencies
sudo apt install python3-picamera2 -y
```

## Model loading on IMX500

https://developer.aitrios.sony-semicon.com/en/docs/raspberry-pi-ai-camera/imx500-converter?version=3.14.3&progLang=

### Convert yolo to onnx

Usually we use 

```
yolo export model=../models/<model_name>.pt format=imx
```

It will create a folder with `packerOut.zip` inside.

### Convert onnx to imx500 format

```
sudo apt install imx500-tools
imx500-package -i packerOut.zip -o yolov8n-face.rpk
```