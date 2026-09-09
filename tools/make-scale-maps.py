# Builds the PBR helper maps for the dragon skin from dist/dragon-scales.webp (albedo).
# Output (dist/assets):
#   dragon-scales_nor_gl_1k.jpg  OpenGL-style tangent normal map (green = +Y up in UV space) from a height field
#   dragon-scales_arm_1k.jpg     R = ambient occlusion (scale seams dark), G = roughness (plate centres smoother, seams rough), B = metalness (0)
#   *_512.jpg                    phone-tier copies
# Height = blurred luminance; scale plates read as raised, seams as grooves. Strength tuned so the normal map is strong at 1.0 normalScale.
import numpy as np
from PIL import Image, ImageFilter
import os
root=os.path.join(os.path.dirname(__file__),'..','dist')
src=Image.open(os.path.join(root,'dragon-scales.webp')).convert('RGB')
lum=np.asarray(src.convert('L'),dtype=np.float32)/255.0
# Two-scale height: broad plate dome (blur 6px) + fine cracks (unblurred), seams pushed down by darkness.
broad=np.asarray(Image.fromarray((lum*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)),dtype=np.float32)/255.0
height=broad*0.75+lum*0.25
height=(height-height.min())/(height.max()-height.min()+1e-6)
def sobel(h,strength):
    hp=np.pad(h,1,mode='wrap')
    gx=(hp[1:-1,2:]-hp[1:-1,:-2])*0.5
    gy=(hp[2:,1:-1]-hp[:-2,1:-1])*0.5
    nx=-gx*strength; ny=gy*strength; nz=np.ones_like(h)   # OpenGL convention: +Y = up in texture space (row 0 is the top of the image, so flip gy)
    ny=-ny
    n=np.stack([nx,ny,nz],-1); n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return ((n*0.5+0.5)*255).astype(np.uint8)
normal=sobel(height,14.0)
# AO: how far below the local average this pixel sits (grooves are occluded).
avg=np.asarray(Image.fromarray((height*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)),dtype=np.float32)/255.0
ao=np.clip(1.0-(avg-height)*3.0,0.35,1.0)
# Roughness: plate centres (bright, smooth) ~0.45, seams ~0.9, plus fine grain from the albedo cracks.
rough=np.clip(0.9-height*0.45+(0.5-lum)*0.25,0.3,0.95)
arm=np.stack([ao*255,rough*255,np.zeros_like(ao)],-1).astype(np.uint8)
out=os.path.join(root,'assets')
Image.fromarray(normal).save(os.path.join(out,'dragon-scales_nor_gl_1k.jpg'),quality=92)
Image.fromarray(arm).save(os.path.join(out,'dragon-scales_arm_1k.jpg'),quality=92)
Image.fromarray(normal).resize((512,512),Image.LANCZOS).save(os.path.join(out,'dragon-scales_nor_gl_512.jpg'),quality=90)
Image.fromarray(arm).resize((512,512),Image.LANCZOS).save(os.path.join(out,'dragon-scales_arm_512.jpg'),quality=90)
print('ok',normal.shape,'rough range',rough.min(),rough.max(),'ao range',ao.min(),ao.max())
