#include <vpx/vpx_encoder.h>
#include <vpx/vpx_decoder.h>
#include <vpx/vp8cx.h>
#include <vpx/vp8dx.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

typedef struct { vpx_codec_ctx_t ctx; vpx_image_t *image; int64_t pts; int fps; } Encoder;
void *mumh5_encoder_new(unsigned w, unsigned h, unsigned fps) {
    Encoder *e = calloc(1, sizeof(*e)); if (!e) return NULL;
    vpx_codec_enc_cfg_t cfg;
    if (vpx_codec_enc_config_default(vpx_codec_vp8_cx(), &cfg, 0)) { free(e); return NULL; }
    cfg.g_w = w; cfg.g_h = h; cfg.g_timebase.num = 1; cfg.g_timebase.den = fps;
    cfg.g_threads = 2; cfg.g_lag_in_frames = 0; cfg.g_error_resilient = VPX_ERROR_RESILIENT_DEFAULT;
    cfg.rc_end_usage = VPX_CBR; cfg.rc_target_bitrate = 600; cfg.kf_max_dist = fps * 2;
    if (vpx_codec_enc_init(&e->ctx, vpx_codec_vp8_cx(), &cfg, 0)) { free(e); return NULL; }
    vpx_codec_control(&e->ctx, VP8E_SET_CPUUSED, 8);
    e->image = vpx_img_alloc(NULL, VPX_IMG_FMT_I420, w, h, 1); e->fps = fps;
    if (!e->image) { vpx_codec_destroy(&e->ctx); free(e); return NULL; }
    return e;
}
int mumh5_encode(void *ptr, const uint8_t *input, size_t len, uint8_t *output, size_t cap) {
    Encoder *e = ptr; size_t w = e->image->d_w, h = e->image->d_h;
    if (len != w * h * 3 / 2) return -1;
    for (int p = 0; p < 3; p++) {
        size_t pw = p ? w/2 : w, ph = p ? h/2 : h;
        for (size_t y = 0; y < ph; y++) memcpy(e->image->planes[p] + y * e->image->stride[p], input + y * pw, pw);
        input += pw * ph;
    }
    int flags = e->pts % (e->fps * 2) == 0 ? VPX_EFLAG_FORCE_KF : 0;
    if (vpx_codec_encode(&e->ctx, e->image, e->pts++, 1, flags, VPX_DL_REALTIME)) return -1;
    vpx_codec_iter_t it = NULL; const vpx_codec_cx_pkt_t *packet;
    while ((packet = vpx_codec_get_cx_data(&e->ctx, &it))) {
        if (packet->kind == VPX_CODEC_CX_FRAME_PKT) {
            if (packet->data.frame.sz > cap) return -1;
            memcpy(output, packet->data.frame.buf, packet->data.frame.sz); return (int)packet->data.frame.sz;
        }
    }
    return 0;
}
void mumh5_encoder_free(void *ptr) {
    if (!ptr) return;
    Encoder *e = ptr; vpx_codec_destroy(&e->ctx); vpx_img_free(e->image); free(e);
}
void *mumh5_decoder_new(void) {
    vpx_codec_ctx_t *d = calloc(1, sizeof(*d)); if (!d) return NULL;
    vpx_codec_dec_cfg_t cfg = { .threads = 2, .w = 0, .h = 0 };
    if (vpx_codec_dec_init(d, vpx_codec_vp8_dx(), &cfg, 0)) { free(d); return NULL; } return d;
}
int mumh5_decode(void *ptr, const uint8_t *input, size_t len, uint8_t *output, size_t cap, unsigned *w, unsigned *h) {
    vpx_codec_ctx_t *d = ptr;
    if (vpx_codec_decode(d, input, (unsigned)len, NULL, 0)) return -1;
    vpx_codec_iter_t it = NULL; vpx_image_t *image = vpx_codec_get_frame(d, &it);
    if (!image) return 0;
    *w = image->d_w; *h = image->d_h;
    if (*w < 2 || *h < 2 || *w > 4096 || *h > 2160 || *w % 2 || *h % 2 || (size_t)*w * *h * 3 / 2 > cap) return -1;
    if (image->fmt != VPX_IMG_FMT_I420) return -1;
    size_t size = (size_t)*w * *h * 3 / 2;
    for (int p = 0; p < 3; p++) {
        unsigned pw = p ? *w/2 : *w, ph = p ? *h/2 : *h;
        for (unsigned y = 0; y < ph; y++) memcpy(output + y * pw, image->planes[p] + y * image->stride[p], pw);
        output += pw * ph;
    }
    return (int)size;
}
void mumh5_decoder_free(void *ptr) { if (ptr) { vpx_codec_destroy(ptr); free(ptr); } }
