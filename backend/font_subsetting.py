"""Subset new fonts without reindexing legacy simple-font encodings.

MuPDF 1.25.2 can drop a glyph from a MacRoman-only TrueType cmap without
updating the remaining glyph indices. Unicode extraction still looks correct,
but the rendered symbols change. Preserve those embedded programs and their
PDF mappings; continue subsetting the (usually much larger) translated fonts.
"""


def _reference(pdf, xref, key):
    kind, value = pdf.xref_get_key(xref, key)
    return int(value.split()[0]) if kind == 'xref' else None


def subset_fonts_preserving_legacy_encodings(pdf):
    objects, streams, protected = {}, {}, set()
    for page in pdf:
        for font in page.get_fonts(full=True):
            xref = font[0]
            if xref in protected or pdf.xref_get_key(xref, 'Subtype') != ('name', '/TrueType'):
                continue
            if pdf.xref_get_key(xref, 'Encoding') != ('name', '/MacRomanEncoding'):
                continue
            descriptor = _reference(pdf, xref, 'FontDescriptor')
            program = _reference(pdf, descriptor, 'FontFile2') if descriptor else None
            if not program:
                continue
            protected.add(xref)
            for item in (xref, descriptor, program):
                objects.setdefault(item, pdf.xref_object(item))
            streams.setdefault(program, pdf.xref_stream(program))
    try:
        pdf.subset_fonts(fallback=False)
    finally:
        # Restore the font dictionary too: FirstChar/Widths and the embedded
        # program form one mapping, including when several fonts share a file.
        for xref, value in objects.items():
            pdf.update_object(xref, value)
        for xref, value in streams.items():
            pdf.update_stream(xref, value)
    return {'preservedFonts': len(protected),
            'preservedProgramBytes': sum(len(value) for value in streams.values())}
