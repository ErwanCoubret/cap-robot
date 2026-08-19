import model_compression_toolkit as mct
from torch.utils.data import DataLoader
from pathlib import Path
from ultralytics import YOLO
import torch
import numpy as np
from PIL import Image

# ==========================================
# CONFIGURATION
# ==========================================
MODEL_PT_PATH = "../models/yolov8n-face-lindevs.pt"         # Ton modèle YOLOv8 de GitHub
CALIBRATION_IMAGES_DIR = "./images"    # Ton dossier rempli d'images (image_0.png)
OUTPUT_QUANT_MODEL_PATH = "../models/yolov8n-face-mct.onnx" # Nom du modèle quantifié de sortie
IMAGE_SIZE = (320, 320)                 # Taille d'image attendue par ton YOLOv8 (carré)
BATCH_SIZE = 16                          # Nombre d'images traitées en même temps (si RAM suffisante)

# ==========================================
# 1. Préparation du Representative Dataset Generator
# ==========================================
# Cette fonction est CRUCIALE. C'est elle qui envoie tes images au MCT.
def representative_data_gen():
    images_list = list(Path(CALIBRATION_IMAGES_DIR).glob("*.jpg"))
    if not images_list:
        raise FileNotFoundError(f"Dossier '{CALIBRATION_IMAGES_DIR}' est vide ! Prends des photos avant.")
    print(f"📂 Calibration : {len(images_list)} images trouvées.")
    
    # On trie pour avoir un ordre déterministe
    images_list.sort()
    
    # Pour chaque image
    for img_path in images_list:
        # Charger l'image, la mettre en couleurs (RGB) et la redimensionner
        try:
            img = Image.open(img_path).convert('RGB')
            img = img.resize(IMAGE_SIZE, Image.Resampling.BILINEAR)
            
            # Convertir en tableau NumPy, normaliser entre 0 et 1, et changer l'ordre des axes
            # (H, W, C) -> (C, H, W) comme l'attend PyTorch
            img_np = np.array(img).astype(np.float32) / 255.0
            img_np = np.transpose(img_np, (2, 0, 1))
            
            # Ajouter la dimension "batch" (1, C, H, W) et céder l'image
            yield [img_np[np.newaxis, ...]]
            
        except Exception as e:
            print(f"⚠️ Erreur de chargement de l'image {img_path}: {e}")

# ==========================================
# 2. Exécution de la Quantification
# ==========================================
print("⏳ Chargement du modèle PyTorch YOLOv8...")
# Charger le modèle Ultralytics (on garde juste le réseau PyTorch, pas les fioritures d'Ultralytics)
model = YOLO(MODEL_PT_PATH).model
model.eval() # Mode évaluation indispensable

# On n'a pas besoin de GPU pour la calibration, c'est rapide sur CPU
device = torch.device("cpu")
model.to(device)

for m in model.modules():
    if hasattr(m, 'export'):
        m.export = True    # Désactive les boucles dynamiques
    if hasattr(m, 'dynamic'):
        m.dynamic = False  # Force des dimensions fixes
    if hasattr(m, 'format'):
        m.format = 'onnx'  # Prépare la couche pour un export propre

print(f"🚀 Démarrage du MCT (Quantification Post-Training) pour {OUTPUT_QUANT_MODEL_PATH}...")
print("C'est là que les 'minMaxes' sont calculés !")

try:
    # C'est LA fonction qui fait tout le travail !
    # Elle cible spécifiquement la target "imx500_tpc/v1" pour ta caméra AI.
    quantized_model, quantization_info = mct.ptq.pytorch_post_training_quantization(
        model,
        representative_data_gen,
        target_platform_capabilities=mct.get_target_platform_capabilities(tpc_version='1.0', device_type='imx500') # https://github.com/SonySemiconductorSolutions/mct-model-optimization/blob/main/model_compression_toolkit/target_platform_capabilities/README.md
    )

    print("✅ Quantification terminée avec succès !")

    # ==========================================
    # 3. Exportation du modèle au format ONNX
    # ==========================================
    # L'outil imxconv-pt a besoin d'un ONNX quantifié.
    print(f"📤 Exportation du modèle quantifié vers {OUTPUT_QUANT_MODEL_PATH}...")
    dummy_input = torch.randn(1, 3, *IMAGE_SIZE, device=device)
    
    # Exporter en ONNX
    torch.onnx.export(
        quantized_model, 
        dummy_input, 
        OUTPUT_QUANT_MODEL_PATH, 
        opset_version=13, # Recommandé pour IMX500
        input_names=['input'], 
        output_names=['output']
    )
    print("🎉 Modèle ONNX quantifié prêt pour 'imxconv-pt' !")

except Exception as e:
    print(f"❌ Erreur lors du MCT : {e}")