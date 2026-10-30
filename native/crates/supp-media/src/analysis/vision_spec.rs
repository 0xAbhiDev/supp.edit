//! Model-specific contracts. A CLIP processor is deliberately not a detector processor.
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionModelSpec {
    pub name: &'static str,
    pub input_width: u32,
    pub input_height: u32,
    pub tensor_layout: &'static str,
    pub color_order: &'static str,
    pub normalization: &'static str,
    pub mean: [f32; 3],
    pub std: [f32; 3],
    pub resize_mode: &'static str,
    pub interpolation: &'static str,
    pub letterbox: Option<u8>,
    pub input_name: &'static str,
    pub output_name: &'static str,
    pub output_type: &'static str,
}
pub const MOBILECLIP: VisionModelSpec = VisionModelSpec {
    name: "MobileCLIP S0 image fp32",
    input_width: 256,
    input_height: 256,
    tensor_layout: "NCHW float32",
    color_order: "RGB",
    normalization: "divide by 255; no channel normalization",
    mean: [0.; 3],
    std: [1.; 3],
    resize_mode: "shortest edge to 256, center crop",
    interpolation: "bilinear / triangle",
    letterbox: None,
    input_name: "pixel_values",
    output_name: "image_embeds",
    output_type: "[N,512] float32; L2-normalize before cosine",
};
pub const YOLOX: VisionModelSpec = VisionModelSpec {
    name: "YOLOX 0.1.1rc0 release weights",
    input_width: 416,
    input_height: 416,
    tensor_layout: "NCHW float32",
    color_order: "BGR",
    normalization: "raw 0–255; no division or channel normalization",
    mean: [0.; 3],
    std: [1.; 3],
    resize_mode: "fit longest edge to 416, top-left placement, bottom/right padding",
    interpolation: "bilinear / triangle",
    letterbox: Some(114),
    input_name: "images",
    output_name: "output",
    output_type:
        "[1,3549,85] xywh grid offsets, objectness, 80 COCO probabilities; decode strides 8/16/32",
};
