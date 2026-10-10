"""Locate prose brackets and author/year citations outside PDF math tokens."""
import re

STYLE = re.compile(r"</?style(?: id='\d+')?>")


def visible(text):
    return STYLE.sub('', text)


def styled_slice(source, start, end):
    """Cut at a prose boundary while closing/reopening the active style.

    PDF color runs commonly put '(' and ')' in different runs from an author
    name. Each resulting fragment remains valid markup with the same style IDs.
    """
    def active(position):
        stack=[]
        for match in STYLE.finditer(source):
            if match.end()>position:break
            if match[0].startswith('</'):
                if stack:stack.pop()
            else:stack.append(match[0])
        return stack
    value=''.join(active(start))+source[start:end]+'</style>'*len(active(end))
    return re.sub(r"<style id='\d+'></style>",'',value)


def scientific_literals(source, context=None):
    """Resolve reference labels together with their colored number, not alone.

    The visible offset map permits a label/number to span several style runs.
    Sending "Fig." alone to the model can invent "图1" before the real number.
    """
    plain=[];offsets=[];cursor=0
    for tag in STYLE.finditer(source):
        plain.extend(source[cursor:tag.start()]);offsets.extend(range(cursor,tag.start()));cursor=tag.end()
    plain.extend(source[cursor:]);offsets.extend(range(cursor,len(source)))
    plain=''.join(plain)
    labels={'fig':'图','figure':'图','eq':'式','equation':'式','listing':'代码清单',
            'table':'表','sec':'节','section':'节','algorithm':'算法'}
    pattern=re.compile(r'\b(?P<label>Figures?|Figs?\.?|Equations?|Eqs?\.?|Listings?|Tables?|Sections?|Secs?\.?|Algorithms?)\s*(?P<number>\d+(?:\.\d+)*(?:[a-z]|\([a-z0-9]+\))?)(?!\w)',re.I)
    def styled_label(start, value):
        fragment=styled_slice(source,start,start+1)
        return ''.join(part if STYLE.fullmatch(part) else value if part else ''
                       for part in re.split('('+STYLE.pattern+')',fragment))
    matches=[]
    where=re.match(r'\s*(where)\b',plain,re.I)
    definition=re.match(r'\s*where\s+(?:\{\s*v\s*\d+\s*\}|[A-Za-z]\w{0,2})\s+(?:is|are|denotes?|represents?|stands\s+for)\b',plain,re.I)
    if where and ((context or {}).get('precededByFormula') or definition):
        start,end=offsets[where.start(1)],offsets[where.end(1)-1]+1
        matches.append((start,end,styled_label(start,'其中')))
    for match in pattern.finditer(plain):
        start,end=offsets[match.start()],offsets[match.end()-1]+1
        label=match['label'].lower().rstrip('.').rstrip('s')
        number=styled_slice(source,offsets[match.start('number')],offsets[match.end('number')-1]+1)
        # Retain the label's style, and independently retain the link's color.
        prefix=styled_label(start,labels[label])
        matches.append((start,end,prefix+' '+number))
    for match in re.finditer(r'\b(?:i\.e\.|e\.g\.)(?:,)?',plain,re.I):
        start,end=offsets[match.start()],offsets[match.end()-1]+1
        value='即' if match[0].lower().startswith('i') else '例如'
        matches.append((start,end,styled_label(start,value)))
    match=re.match(r'\s*(\d{1,3}[.)])\s+(?=[A-Za-z])',plain)
    if match:
        start,end=offsets[match.start(1)],offsets[match.end(1)-1]+1
        matches.append((start,end,styled_slice(source,start,end)))
    # Citation metadata (e.g. "Smith, 2024, Section 2") remains verbatim.
    # Replacing its section label first would hide the author/year pattern.
    literal_ranges=[(a,b) for a,b,inner in protected_ranges(source) if inner is None]
    return sorted((a,b,value) for a,b,value in matches
                  if not any(start<=a and b<=end for start,end in literal_ranges))


def citation(text, tail=False):
    text=visible(text).strip()
    if len(text)>600 or '{v' in text:
        return False
    if tail:
        return bool(re.fullmatch(r'et\s+al\.,\s*(?:19|20)\d{2}[a-z]?(?:,\s*(?:Lemma|Theorem|Section|Proposition|Corollary|Eq\.?|pp?\.)\s+[\w.\-–]+)?',text,re.I))
    parts=text.split(';')
    return all(re.fullmatch(r'(?:see\s+|e\.g\.,?\s*)?[A-ZÀ-Ž][^\d(){}]{1,100},\s*(?:19|20)\d{2}[a-z]?(?:,\s*(?:Lemma|Theorem|Section|Proposition|Corollary|Eq\.?|pp?\.)\s+[\w.\-–]+)?',part.strip()) for part in parts)


def protected_ranges(source):
    """Yield nonoverlapping (start,end,inner) groups; inner=None is literal.

    A bracket can continue across columns/paragraphs. Preserve unmatched ends
    rather than inventing a partner. Do not split style tags across groups.
    """
    start=0
    # A citation continued from the preceding column, with its closing marker.
    close=source.find(')')
    if close>=0 and '(' not in source[:close] and citation(source[:close],tail=True):
        end=close+1
        if source[end:end+1]=='.':end+=1
        yield 0,end,None
        start=end
    pairs={')':'(',']':'['}
    stack=[]
    groups=[]
    for i in range(start,len(source)):
        c=source[i]
        if c in '([':
            stack.append((c,i))
        elif c in pairs:
            if stack and stack[-1][0]==pairs[c]:
                _,a=stack.pop()
                if not stack:
                    inner=source[a+1:i]
                    literal=citation(inner) or not re.search(r'[A-Za-z]{2}',visible(inner)) or bool(re.fullmatch(r'[A-Z][A-Z\d-]{1,14}',visible(inner)))
                    end=i+1
                    if citation(inner) and source[end:end+1]=='.':
                        end+=1
                    groups.append((a,end,None if literal else inner))
            elif not stack:
                groups.append((i,i+1,None))
    if stack:
        # Includes any nested matched group inside an unmatched outer opening.
        first=stack[0][1]
        remainder=visible(source[first+1:]).strip()
        if re.fullmatch(r"[A-ZÀ-Ž][A-Za-zÀ-ž'’-]+(?:\s+et\s+al\.?)?",remainder):
            groups.append((first,len(source),None))
        else:
            groups.extend((j,j+1,None) for j in range(first,len(source)) if source[j] in '()[]')
    yield from sorted(groups)
