import io
import sys
from pathlib import Path

import pymupdf
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from font_subsetting import subset_fonts_preserving_legacy_encodings


def legacy_pdf():
    """Small original fixture: an unused space precedes all displayed glyphs."""
    builder = FontBuilder(1000, isTTF=True)
    names = ['.notdef', 'space', 'A', 'B', 'C']
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({32: 'space', 65: 'A', 66: 'B', 67: 'C'})
    glyphs = {}
    for index, name in enumerate(names):
        pen = TTGlyphPen(None)
        if index > 1:
            pen.moveTo((20, 0)); pen.lineTo((100*index, 0))
            pen.lineTo((100*index, 100*index)); pen.lineTo((20, 100*index)); pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (500, 0) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'LegacyTest', 'styleName': 'Regular',
                           'uniqueFontIdentifier': 'PDFSandwichLegacyTest',
                           'fullName': 'LegacyTest Regular', 'psName': 'LegacyTest-Regular'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost(keepGlyphNames=True)
    cmap = CmapSubtable.newSubtable(6)
    cmap.platformID, cmap.platEncID, cmap.language = 1, 0, 0
    cmap.cmap = {32: 'space', 65: 'A', 66: 'B', 67: 'C'}
    builder.font['cmap'].tables = [cmap]
    buffer = io.BytesIO(); builder.font.save(buffer)
    pdf = pymupdf.open(); page = pdf.new_page(width=200, height=100)
    program, descriptor, font, content = [pdf.get_new_xref() for _ in range(4)]
    pdf.update_object(program, '<< >>'); pdf.update_stream(program, buffer.getvalue())
    pdf.update_object(descriptor, f'<< /Type /FontDescriptor /FontName /LegacyTest-Regular /Flags 32 /FontBBox [0 -200 500 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 {program} 0 R >>')
    pdf.update_object(font, f'<< /Type /Font /Subtype /TrueType /BaseFont /LegacyTest-Regular /Encoding /MacRomanEncoding /FirstChar 32 /LastChar 67 /Widths [ {" ".join(["500"]*36)} ] /FontDescriptor {descriptor} 0 R >>')
    pdf.update_object(content, '<< >>'); pdf.update_stream(content, b'BT /F1 30 Tf 1 0 0 1 20 40 Tm (ABC) Tj ET')
    pdf.xref_set_key(page.xref, 'Resources', f'<< /Font << /F1 {font} 0 R >> >>')
    pdf.xref_set_key(page.xref, 'Contents', f'{content} 0 R')
    return pdf, program


def test_legacy_cmap_and_rendering_survive_unused_glyph_removal(tmp_path):
    pdf, program = legacy_pdf()
    before_bytes = pdf.xref_stream(program)
    # Reopen before rendering: comparisons must not use MuPDF's cached font.
    original = pymupdf.open(stream=pdf.tobytes(), filetype='pdf')
    expected = original[0].get_pixmap().samples
    report = subset_fonts_preserving_legacy_encodings(pdf)
    assert report == {'preservedFonts': 1, 'preservedProgramBytes': len(before_bytes)}
    assert pdf.xref_stream(program) == before_bytes
    file = tmp_path/'subset.pdf'; pdf.save(file, garbage=1, deflate=True)
    with pymupdf.open(file) as actual:
        assert actual[0].get_pixmap().samples == expected
        assert actual[0].get_text().strip() == 'ABC'


def test_regular_font_still_uses_native_subsetter():
    pdf = pymupdf.open(); page = pdf.new_page(); page.insert_text((30, 50), 'Regular text')
    report = subset_fonts_preserving_legacy_encodings(pdf)
    assert report == {'preservedFonts': 0, 'preservedProgramBytes': 0}
    with pymupdf.open(stream=pdf.tobytes(), filetype='pdf') as result:
        assert result[0].get_text().strip() == 'Regular text'
