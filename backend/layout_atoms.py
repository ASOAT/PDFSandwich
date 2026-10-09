"""Reassemble geometric math atoms and keep numbered list items separate."""
import copy
import re


def protect_inline_badges(page):
    """Keep a compact numbered badge and its vector background in one atom.

    A white digit can look like ordinary prose to the style classifier. Its
    circle then stays at the source coordinate while the digit reflows away.
    Enlarging the visual bounds (not the glyph's drawing coordinates) lets
    upstream collect the whole background and reserve its width/height.
    """
    from babeldoc.format.pdf.document_il.il_version_1 import Box, VisualBbox
    from layout_preservation import characters
    paragraphs=[(p,list(characters(p))) for p in page.pdf_paragraph
                if p.layout_label not in ('formula','figure','table')]
    for index,curve in enumerate(page.pdf_curve):
        b=curve.box
        if not b or not curve.fill_background or not 3<b.x2-b.x<30 or not 3<b.y2-b.y<30:
            continue
        if not .65<(b.x2-b.x)/(b.y2-b.y)<1.55:continue
        matches=[]
        for paragraph,chars in paragraphs:
            inside=[c for c in chars if (c.char_unicode or '').strip() and c.xobj_id==curve.xobj_id
                    and b.x<=visual(c).x and b.x2>=visual(c).x2 and b.y<=visual(c).y and b.y2>=visual(c).y2]
            label=''.join(c.char_unicode or '' for c in inside)
            if not re.fullmatch(r'\d{1,2}|[A-Za-z]',label):continue
            size=max(c.pdf_style.font_size for c in inside)
            if not .65*size<b.y2-b.y<1.6*size:continue
            if any(c.render_order is not None and curve.render_order is not None and c.render_order<curve.render_order for c in inside):continue
            matches.append(inside)
        if len(matches)!=1:continue
        for char in matches[0]:
            char.formula_layout_id=-300000-index
            a=visual(char)
            char.visual_bbox=VisualBbox(box=Box(min(a.x,b.x),min(a.y,b.y),max(a.x2,b.x2),max(a.y2,b.y2)))


def split_numbered_lists(page):
    from layout_preservation import union_box
    from reference_layout import explicit_word_spaces
    from babeldoc.format.pdf.document_il.utils.layout_helper import get_char_unicode_string
    result=[]
    for paragraph in page.pdf_paragraph:
        compositions=paragraph.pdf_paragraph_composition
        if paragraph.layout_label in ('title','reference') or not all(c.pdf_line for c in compositions):
            result.append(paragraph);continue
        markers=[]
        for i,comp in enumerate(compositions):
            chars=comp.pdf_line.pdf_character
            text=''.join(c.char_unicode or ' ' for c in chars)
            match=re.match(r'^\s*(\d{1,3}[.)])\s+(?=[A-Za-z])',text)
            if match:
                end=0;prefix=''
                while end<len(chars) and len(prefix)<match.end():
                    prefix+=chars[end].char_unicode or ' ';end+=1
                if end<len(chars):markers.append((i,end,int(re.match(r'\d+',match[1])[0]),chars[0].box.x))
        if (len(markers)<2 or markers[0][0]!=0
                or any(b[2]!=a[2]+1 or abs(b[3]-a[3])>4 for a,b in zip(markers,markers[1:]))):
            result.append(paragraph);continue
        for n,(begin,end,_,_) in enumerate(markers):
            stop=markers[n+1][0] if n+1<len(markers) else len(compositions)
            entry=copy.copy(paragraph)
            entry.pdf_paragraph_composition=copy.deepcopy(compositions[begin:stop])
            first=entry.pdf_paragraph_composition[0].pdf_line
            page.pdf_character.extend(first.pdf_character[:end])
            first.pdf_character=first.pdf_character[end:]
            first.box=union_box(first.pdf_character)
            for comp in entry.pdf_paragraph_composition:
                comp.pdf_line.pdf_character=explicit_word_spaces(comp.pdf_line.pdf_character)
            chars=[c for comp in entry.pdf_paragraph_composition for c in comp.pdf_line.pdf_character]
            # Each split item needs its own drawing order. Sharing the parent's
            # order interleaves the first glyph of every item, then every second
            # glyph, breaking PDF text selection despite a correct visual page.
            entry.render_order=min((c.render_order for c in chars if c.render_order is not None),default=None)
            entry.box=union_box(chars)
            entry.box.x2=max(entry.box.x2,paragraph.box.x2)
            entry.unicode=get_char_unicode_string(chars)
            entry.first_line_indent=False
            entry.debug_id=(paragraph.debug_id or '')+f'-list-{n}'
            result.append(entry)
    page.pdf_paragraph=result


def visual(char):
    return char.visual_bbox.box if char.visual_bbox else char.box


def horizontal_gap(a,b):
    return max(0,a.x-b.x2,b.x-a.x2)


def join_formula_atoms(page):
    """A line classifier can place an accent on the preceding prose line.

    Join only geometrically attached formula pieces, without changing glyph
    coordinates. The typesetter then moves/scales every glyph and drawing path
    in an atom together. Reading-order line IDs are deliberately not required.
    """
    from babeldoc.format.pdf.document_il.utils.formular_helper import update_formula_data
    for paragraph in page.pdf_paragraph:
        comps=paragraph.pdf_paragraph_composition

        def formulas():
            return [(i,c.pdf_formula) for i,c in enumerate(comps) if c.pdf_formula]

        def combine(host_index,piece_index):
            host,piece=comps[host_index].pdf_formula,comps[piece_index].pdf_formula
            host.pdf_character.extend(piece.pdf_character)
            host.pdf_curve.extend(piece.pdf_curve);host.pdf_form.extend(piece.pdf_form)
            identity=next((c.formula_layout_id for c in host.pdf_character if c.formula_layout_id),-200000-host_index)
            for char in host.pdf_character:
                char.formula_layout_id=char.formula_layout_id or identity
            update_formula_data(host)
            del comps[piece_index]

        # Accents and small upper/lower scripts attach to a nearby larger math
        # glyph. Keep the host's reading-order position, not the stray accent's.
        changed=True
        while changed:
            changed=False
            for i,piece in formulas():
                chars=[c for c in piece.pdf_character if (c.char_unicode or '').strip()]
                if not chars or len(chars)>5:continue
                size=max(c.pdf_style.font_size for c in chars)
                thin=all(visual(c).y2-visual(c).y < c.pdf_style.font_size*.4 for c in chars)
                choices=[]
                for j,host in formulas():
                    if i==j:continue
                    for base in host.pdf_character:
                        if not (base.char_unicode or '').strip():continue
                        b=visual(base);s=base.pdf_style.font_size
                        if b.y2-b.y<s*.45 or b.y2-b.y>s*1.2:continue
                        a=piece.box
                        overlap=min(a.x2,b.x2)-max(a.x,b.x)
                        if thin:
                            attached=overlap>min(a.x2-a.x,b.x2-b.x)*.35 and 0<=a.y-b.y<=s*1.3 and a.y2>=b.y2-s*.2
                        else:
                            attached=size<s*.86 and horizontal_gap(a,b)<s*.35 and abs(a.y-b.y)<s*.8
                        if attached:choices.append((abs(a.y-b.y2)+horizontal_gap(a,b)*2,j))
                if choices:
                    combine(min(choices)[1],i);changed=True;break

        # A fraction rule binds numerator and denominator even when their
        # baselines were classified as different lines. Never use page rules.
        for curve in page.pdf_curve:
            bar=curve.box
            if not bar or bar.y2-bar.y>.8 or not 1<bar.x2-bar.x<100:continue
            above=[];below=[]
            for i,formula in formulas():
                b=formula.box;s=max((c.pdf_style.font_size for c in formula.pdf_character),default=10)
                if b.x<bar.x-1.5 or b.x2>bar.x2+1.5:continue
                if 0<=b.y-bar.y2<s*.8:above.append((b.y-bar.y2,i))
                if 0<=bar.y-b.y2<s*.8:below.append((bar.y-b.y2,i))
            if above and below:
                top,bottom=min(above)[1],min(below)[1]
                if top!=bottom:combine(top,bottom)

        # Tall delimiters can be assembled from several CMEX glyphs. Bind them
        # to their enclosed fraction/expression rather than treating each piece
        # as an independently wrapping word.
        changed=True
        while changed:
            changed=False
            fonts={f.font_id:f.name for f in page.pdf_font}
            for i,piece in formulas():
                chars=[c for c in piece.pdf_character if (c.char_unicode or '').strip()]
                if not chars or not all('CMEX' in fonts.get(c.pdf_style.font_id,'') or (c.char_unicode or '') in '()[]{}' for c in chars):continue
                size=max(c.pdf_style.font_size for c in chars);a=piece.box
                if a.y2-a.y<size*1.15:continue
                choices=[]
                for j,host in formulas():
                    if i==j:continue
                    b=host.box;overlap=min(a.y2,b.y2)-max(a.y,b.y)
                    if overlap>min(a.y2-a.y,b.y2-b.y)*.7 and horizontal_gap(a,b)<size*.55:
                        choices.append((horizontal_gap(a,b),j))
                if choices:
                    combine(min(choices)[1],i);changed=True;break
