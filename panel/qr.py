"""Generador de códigos QR sin librerías externas (modo byte, versiones 1–10).
Basado en el algoritmo del estándar ISO/IEC 18004. Uso: qr_svg("http://...")."""

# Corrección de errores nivel M (recupera ~15%), versiones 1..10
_ECC_POR_BLOQUE = [None, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
_NUM_BLOQUES = [None, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
_FORMATO_M = 0  # bits de formato del nivel M


def _gf_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(grado):
    r = [0] * (grado - 1) + [1]
    raiz = 1
    for _ in range(grado):
        for j in range(grado):
            r[j] = _gf_mul(r[j], raiz)
            if j + 1 < grado:
                r[j] ^= r[j + 1]
        raiz = _gf_mul(raiz, 0x02)
    return r


def _rs_residuo(datos, divisor):
    r = [0] * len(divisor)
    for b in datos:
        f = b ^ r.pop(0)
        r.append(0)
        for i, c in enumerate(divisor):
            r[i] ^= _gf_mul(c, f)
    return r


def _modulos_datos(ver):
    r = (16 * ver + 128) * ver + 64
    if ver >= 2:
        n = ver // 7 + 2
        r -= (25 * n - 10) * n - 55
        if ver >= 7:
            r -= 36
    return r


def _codewords_datos(ver):
    return _modulos_datos(ver) // 8 - _ECC_POR_BLOQUE[ver] * _NUM_BLOQUES[ver]


def _con_ecc(datos, ver):
    nb, ecc = _NUM_BLOQUES[ver], _ECC_POR_BLOQUE[ver]
    total = _modulos_datos(ver) // 8
    cortos = nb - total % nb
    largo_corto = total // nb
    div = _rs_divisor(ecc)
    bloques, k = [], 0
    for i in range(nb):
        n = largo_corto - ecc + (0 if i < cortos else 1)
        d = datos[k:k + n]
        k += n
        e = _rs_residuo(d, div)
        if i < cortos:
            d = d + [0]
        bloques.append(d + e)
    res = []
    for i in range(len(bloques[0])):
        for j, b in enumerate(bloques):
            if i != largo_corto - ecc or j >= cortos:
                res.append(b[i])
    return res


def _alineacion(ver, tam):
    if ver == 1:
        return []
    n = ver // 7 + 2
    paso = (ver * 8 + n * 3 + 5) // (n * 4 - 4) * 2
    return [6] + [tam - 7 - i * paso for i in range(n - 1)][::-1]


class _Matriz:
    def __init__(self, ver):
        self.ver = ver
        self.t = ver * 4 + 17
        self.m = [[False] * self.t for _ in range(self.t)]
        self.f = [[False] * self.t for _ in range(self.t)]

    def fn(self, x, y, oscuro):
        self.m[y][x] = oscuro
        self.f[y][x] = True

    def patrones(self):
        t = self.t
        for i in range(t):
            self.fn(6, i, i % 2 == 0)
            self.fn(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (t - 4, 3), (3, t - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < t and 0 <= y < t:
                        self.fn(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        pos = _alineacion(self.ver, t)
        n = len(pos)
        for i in range(n):
            for j in range(n):
                if (i == 0 and j == 0) or (i == 0 and j == n - 1) or (i == n - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.fn(pos[i] + dx, pos[j] + dy, max(abs(dx), abs(dy)) != 1)
        self.formato(0)
        if self.ver >= 7:
            r = self.ver
            for _ in range(12):
                r = (r << 1) ^ ((r >> 11) * 0x1F25)
            bits = self.ver << 12 | r
            for i in range(18):
                b = (bits >> i) & 1 == 1
                a, c = t - 11 + i % 3, i // 3
                self.fn(a, c, b)
                self.fn(c, a, b)

    def formato(self, mascara):
        d = _FORMATO_M << 3 | mascara
        r = d
        for _ in range(10):
            r = (r << 1) ^ ((r >> 9) * 0x537)
        bits = (d << 10 | r) ^ 0x5412
        b = lambda i: (bits >> i) & 1 == 1
        t = self.t
        for i in range(6):
            self.fn(8, i, b(i))
        self.fn(8, 7, b(6))
        self.fn(8, 8, b(7))
        self.fn(7, 8, b(8))
        for i in range(9, 15):
            self.fn(14 - i, 8, b(i))
        for i in range(8):
            self.fn(t - 1 - i, 8, b(i))
        for i in range(8, 15):
            self.fn(8, t - 15 + i, b(i))
        self.fn(8, t - 8, True)

    def colocar(self, datos):
        t, i = self.t, 0
        total = len(datos) * 8
        derecha = t - 1
        while derecha >= 1:
            if derecha == 6:
                derecha = 5
            for vert in range(t):
                for j in range(2):
                    x = derecha - j
                    arriba = ((derecha + 1) & 2) == 0
                    y = t - 1 - vert if arriba else vert
                    if not self.f[y][x] and i < total:
                        self.m[y][x] = (datos[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            derecha -= 2

    def mascara(self, k):
        cond = [
            lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
            lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
            lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
            lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
        ][k]
        for y in range(self.t):
            for x in range(self.t):
                if not self.f[y][x] and cond(x, y):
                    self.m[y][x] = not self.m[y][x]

    def penalizacion(self):
        t, m, p = self.t, self.m, 0
        for linea in [m[y] for y in range(t)] + [[m[y][x] for y in range(t)] for x in range(t)]:
            corrida, color = 0, None
            for v in linea:
                if v == color:
                    corrida += 1
                else:
                    if corrida >= 5:
                        p += corrida - 2
                    corrida, color = 1, v
            if corrida >= 5:
                p += corrida - 2
        for y in range(t - 1):
            for x in range(t - 1):
                if m[y][x] == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    p += 3
        oscuros = sum(sum(f) for f in m)
        p += abs(oscuros * 20 - t * t * 10) // (t * t) * 10
        return p


def qr_matriz(texto):
    datos = list(texto.encode("utf-8"))
    for ver in range(1, 11):
        if 4 + 8 + 8 * len(datos) <= _codewords_datos(ver) * 8:
            break
    else:
        raise ValueError("Texto demasiado largo para el QR")
    cap = _codewords_datos(ver) * 8
    bits = []
    agregar = lambda v, n: bits.extend((v >> i) & 1 for i in reversed(range(n)))
    agregar(0b0100, 4)
    agregar(len(datos), 8)
    for b in datos:
        agregar(b, 8)
    agregar(0, min(4, cap - len(bits)))
    agregar(0, (-len(bits)) % 8)
    palabras = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    relleno = 0xEC
    while len(palabras) < cap // 8:
        palabras.append(relleno)
        relleno ^= 0xEC ^ 0x11
    codigos = _con_ecc(palabras, ver)

    mejor, mejor_p = None, None
    for k in range(8):
        mt = _Matriz(ver)
        mt.patrones()
        mt.colocar(codigos)
        mt.mascara(k)
        mt.formato(k)
        p = mt.penalizacion()
        if mejor_p is None or p < mejor_p:
            mejor, mejor_p = mt, p
    return mejor.m


def qr_svg(texto, borde=4, oscuro="#111", claro="#fff"):
    m = qr_matriz(texto)
    t = len(m) + 2 * borde
    trazos = "".join(f"M{x + borde},{y + borde}h1v1h-1z" for y, fila in enumerate(m) for x, v in enumerate(fila) if v)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {t} {t}" shape-rendering="crispEdges">'
            f'<rect width="100%" height="100%" fill="{claro}"/><path d="{trazos}" fill="{oscuro}"/></svg>')
