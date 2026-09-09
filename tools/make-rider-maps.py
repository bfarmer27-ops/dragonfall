# Builds the small texture maps rider.js uses (same pattern as make-scale-maps.py). Output (dist/assets):
#   rope_diff_256.png / rope_nor_256.png   twisted 3-strand rope, x = along the rope, y = around it.
#                                          The albedo is a neutral cream so the material colour tints it
#                                          (orange / blue / leather reins).
#   leather_diff_512.png                   dark brown saddle leather with grain and wear (used with the
#                                          existing leather_nor_512.png).
#   glove_diff_512.png                     darker, more worn leather for the gloves.
import numpy as np, os
from PIL import Image, ImageFilter
out=os.path.join(os.path.dirname(__file__),'..','dist','assets')
rng=np.random.default_rng(7)

def value_noise(size,cells,seed):
    r=np.random.default_rng(seed).random((cells+1,cells+1)).astype(np.float32)
    r[-1,:]=r[0,:];r[:,-1]=r[:,0]                       # tileable
    img=Image.fromarray((r*255).astype(np.uint8)).resize((size,size),Image.BICUBIC)
    return np.asarray(img,dtype=np.float32)/255.0

def fbm(size,seed,octaves=5,base=4):
    acc=np.zeros((size,size),np.float32);amp=1;tot=0
    for o in range(octaves):
        acc+=value_noise(size,base*2**o,seed+o)*amp;tot+=amp;amp*=.5
    return acc/tot

def sobel_normal(h,strength):
    hp=np.pad(h,1,mode='wrap')
    gx=(hp[1:-1,2:]-hp[1:-1,:-2])*.5
    gy=(hp[2:,1:-1]-hp[:-2,1:-1])*.5
    n=np.stack([-gx*strength,gy*strength,np.ones_like(h)],-1)   # OpenGL: +Y up (row 0 = top), so flip gy
    n[...,1]*=-1
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return ((n*.5+.5)*255).astype(np.uint8)

# ---- rope: three helical strands, one full twist per tile along x
S=256
y,x=np.mgrid[0:S,0:S].astype(np.float32)/S
strand=.5+.5*np.cos(2*np.pi*(3*y-1.0*x))            # 3 strands around, twisting once per tile
strand=strand**1.6
fibre=.5+.5*np.cos(2*np.pi*(24*y-8*x))               # fine fibres running along each strand
height=np.clip(strand*.85+fibre*.10+fbm(S,3,4,8)*.10,0,1)
rope_n=sobel_normal(height,9.0)
shade=.62+.38*strand
cream=np.stack([shade*1.0,shade*.93,shade*.80],-1)   # neutral warm cream; material colour tints it
cream=np.clip(cream*(0.85+0.3*fbm(S,11,4,8)[...,None]),0,1)
Image.fromarray((cream*255).astype(np.uint8)).save(os.path.join(out,'rope_diff_256.png'))
Image.fromarray(rope_n).save(os.path.join(out,'rope_nor_256.png'))

# ---- leather: dark brown with pore grain, broad mottling and light wear on the high grain
S=512
grain=fbm(S,21,6,8)
mottle=fbm(S,33,3,2)
base=np.array([0x2a,0x1a,0x10],np.float32)/255
wear=np.array([0x5a,0x3e,0x28],np.float32)/255
t=np.clip((grain-.45)*2.2,0,1)*.35+mottle*.25
col=base[None,None,:]*(1-t[...,None])+wear[None,None,:]*t[...,None]
col*=0.85+0.3*grain[...,None]
Image.fromarray((np.clip(col,0,1)*255).astype(np.uint8)).save(os.path.join(out,'leather_diff_512.png'))

# ---- glove: darker, more even, faint worn knuckle-highlight potential comes from the material sheen
gbase=np.array([0x4a,0x30,0x1e],np.float32)/255
gwear=np.array([0x7a,0x56,0x38],np.float32)/255
t=np.clip((grain-.5)*2.5,0,1)*.3+mottle*.15
col=gbase[None,None,:]*(1-t[...,None])+gwear[None,None,:]*t[...,None]
col*=0.85+0.3*fbm(S,44,6,8)[...,None]
Image.fromarray((np.clip(col,0,1)*255).astype(np.uint8)).save(os.path.join(out,'glove_diff_512.png'))
print('ok')
